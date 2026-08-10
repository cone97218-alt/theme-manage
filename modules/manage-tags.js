/**
 * manage-tags.js
 * 标签管理弹窗、平铺/树形分类与关键词映射编辑
 */

import { state, ctx } from './state.js';
import { THEME_TAGS_KEY, ENABLE_SUBTAGS_KEY } from './constants.js';
import { escapeHtml } from './utils.js';
import { loadThemeTags, saveThemeTags, getValidInstalledThemeNames, refreshAllParsedThemesTags } from './tags-core.js';
import { renderTagsUI, isSubtagsEnabled } from './tags-ui.js';
import { softRefreshUI, updateActiveState } from './theme-ui.js';
import { promptAction } from './api.js';

export async function openTagKeywordsModal(tag, onSave) {

                    let keywords = [...(tag.keywords || [])];

                    const buildKeywordsPillsHtml = () => {
                        if (keywords.length === 0) {
                            return `<div style="text-align:center; padding:16px; font-size:12px; opacity:0.5; border:1px dashed rgba(128,128,128,0.3); border-radius:6px; background:rgba(0,0,0,0.1); width:100%;">暂无关键词，请在上方输入添加</div>`;
                        }
                        return keywords.map((kw, idx) => `
                            <span class="tm-kw-pill" style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; background:rgba(74,144,226,0.15); border:1px solid rgba(74,144,226,0.3); border-radius:14px; font-size:12px; font-weight:500; color:var(--SmartThemeQuoteColor, #4a90e2); margin:3px; writing-mode:horizontal-tb !important; user-select:none;">
                                <i class="fa-solid fa-key" style="font-size:10px; opacity:0.7;"></i>
                                <span>${escapeHtml(kw)}</span>
                                <i class="fa-solid fa-xmark btn-remove-kw" data-idx="${idx}" style="cursor:pointer; opacity:0.6; font-size:11px; margin-left:2px;" title="删除此关键词"></i>
                            </span>
                        `).join('');
                    };

                    let modalHtml = `
                        <div style="display:flex; flex-direction:column; gap:12px; writing-mode:horizontal-tb !important;">
                            <div style="font-size:12px; opacity:0.85; line-height:1.5; background:rgba(255,255,255,0.04); padding:10px 12px; border-radius:6px; border-left:3px solid var(--SmartThemeQuoteColor, #4a90e2);">
                                <i class="fa-solid fa-circle-info" style="color:var(--SmartThemeQuoteColor, #4a90e2); margin-right:4px;"></i>
                                当导入或重命名美化主题时，如果主题名称或文件名中包含以下任一关键词，将自动匹配归入标签「<b>${escapeHtml(tag.name)}</b>」。
                            </div>

                            <div style="display:flex; gap:8px; align-items:center;">
                                <input type="text" id="tm-kw-input" class="text_pole" placeholder="输入新关键词 (按 Enter 或点添加，支持逗号分隔多个)" style="flex:1; min-width:0; height:34px; font-size:12px;">
                                <button id="tm-btn-add-kw" class="menu_button" style="margin:0; white-space:nowrap; height:34px; padding:0 14px;"><i class="fa-solid fa-plus"></i> 添加</button>
                            </div>

                            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
                                <span style="font-size:12px; font-weight:bold;">已绑定的关键词 (<span id="tm-kw-count">${keywords.length}</span>)</span>
                                <button id="tm-btn-clear-kws" class="menu_button" style="margin:0; font-size:11px; padding:2px 8px; opacity:0.8;" ${keywords.length === 0 ? 'disabled' : ''}><i class="fa-solid fa-trash-can"></i> 清空全部</button>
                            </div>

                            <div id="tm-kw-pills-container" style="max-height:180px; overflow-y:auto; padding:8px; border:1px solid rgba(128,128,128,0.2); border-radius:6px; background:rgba(0,0,0,0.15); display:flex; flex-wrap:wrap; align-content:flex-start;">
                                ${buildKeywordsPillsHtml()}
                            </div>

                            <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:11px; opacity:0.85; margin-top:4px; user-select:none;">
                                <input type="checkbox" id="chk-auto-apply-kw" checked>
                                <span>保存时自动对现有所有美化重新应用此关键词映射</span>
                            </label>
                        </div>
                    `;

                    await ctx.callGenericPopup(modalHtml, 'confirm', null, {
                        title: `编辑关键词映射 - ${tag.name}`,
                        okButton: '保存生效',
                        cancelButton: '取消',
                        wide: true,
                        onOpen: (popup) => {
                            const dlg = popup.dlg;
                            const kwInput = dlg.querySelector('#tm-kw-input');
                            const addBtn = dlg.querySelector('#tm-btn-add-kw');
                            const clearBtn = dlg.querySelector('#tm-btn-clear-kws');
                            const container = dlg.querySelector('#tm-kw-pills-container');
                            const countEl = dlg.querySelector('#tm-kw-count');
                            const okBtn = dlg.querySelector('.popup-button-ok');

                            const refreshPills = () => {
                                if (container) container.innerHTML = buildKeywordsPillsHtml();
                                if (countEl) countEl.textContent = keywords.length;
                                if (clearBtn) clearBtn.disabled = keywords.length === 0;

                                dlg.querySelectorAll('.btn-remove-kw').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const idx = parseInt(btn.dataset.idx);
                                        if (!isNaN(idx) && idx >= 0 && idx < keywords.length) {
                                            keywords.splice(idx, 1);
                                            refreshPills();
                                        }
                                    });
                                });
                            };

                            const addKeyword = () => {
                                if (!kwInput) return;
                                const val = kwInput.value.trim();
                                if (!val) return;

                                const newKws = val.split(/[,，\s]/).map(k => k.trim()).filter(k => k.length > 0);
                                let addedCount = 0;
                                newKws.forEach(k => {
                                    if (!keywords.includes(k)) {
                                        keywords.push(k);
                                        addedCount++;
                                    }
                                });

                                if (addedCount > 0) {
                                    kwInput.value = '';
                                    refreshPills();
                                } else {
                                    toastr.warning('输入的关键词已存在');
                                }
                            };

                            if (addBtn) addBtn.addEventListener('click', addKeyword);
                            if (kwInput) {
                                kwInput.addEventListener('keydown', (e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        addKeyword();
                                    }
                                });
                            }

                            if (clearBtn) {
                                clearBtn.addEventListener('click', () => {
                                    if (confirm('确定要清空该标签的所有关键词吗？')) {
                                        keywords = [];
                                        refreshPills();
                                    }
                                });
                            }

                            if (okBtn) {
                                okBtn.addEventListener('click', () => {
                                    tag.keywords = keywords;
                                    const autoApply = dlg.querySelector('#chk-auto-apply-kw')?.checked;
                                    if (onSave) onSave(tag, autoApply);
                                });
                            }

                            refreshPills();
                        }
                    });
                }

                export async function openManageTagsPopup() {
                    let tags = loadThemeTags();
                    let subtagsEnabled = isSubtagsEnabled();
                    let isBatchDeleteMode = false;
                    const selectedTagIds = new Set();

                    let popupHtml = `
                        <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; border-bottom:1px solid rgba(128,128,128,0.2); padding-bottom:10px;">
                            <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:12px; font-weight:bold; user-select:none;">
                                <input type="checkbox" id="chk-enable-subtags" ${subtagsEnabled ? 'checked' : ''}>
                                <span>开启二级目录模式</span> <small style="opacity:0.6; font-weight:normal;">(支持一级目录/二级标签)</small>
                            </label>
                            <button id="batch-delete-tags-mode-btn" class="menu_button" style="margin:0; font-size:12px; padding:4px 12px; white-space:nowrap; word-break:keep-all; flex-shrink:0; background:rgba(220,53,69,0.15) !important; color:#ff8888 !important; display:inline-flex !important; flex-direction:row !important; align-items:center !important; justify-content:center !important; writing-mode:horizontal-tb !important; width:auto !important; height:auto !important; min-height:28px !important; gap:4px;"><i class="fa-solid fa-trash-can" style="margin-right:4px;"></i> 批量删除标签</button>
                        </div>
                        <div id="tm-batch-delete-bar" style="display:none; background:rgba(220,53,69,0.12); padding:8px 12px; border-radius:6px; margin-bottom:10px; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; border:1px solid rgba(220,53,69,0.25); writing-mode:horizontal-tb !important;">
                            <span style="font-size:12px; font-weight:bold; color:#ff8888; white-space:nowrap;">
                                <i class="fa-solid fa-list-check" style="margin-right:4px;"></i> 已勾选 <b id="tm-batch-tag-count">0</b> / <span id="tm-batch-tag-total">0</span> 个标签
                            </span>
                            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                <button id="tm-batch-tag-select-all" class="menu_button" style="margin:0; font-size:11px; padding:2px 8px; white-space:nowrap;"><i class="fa-solid fa-check-double"></i> 全选</button>
                                <button id="tm-batch-tag-invert-select" class="menu_button" style="margin:0; font-size:11px; padding:2px 8px; white-space:nowrap;"><i class="fa-solid fa-arrows-rotate"></i> 反选</button>
                                <button id="tm-batch-tag-range-select" class="menu_button" style="margin:0; font-size:11px; padding:2px 8px; white-space:nowrap;" title="移动端/点触连选：依次点击【起点】和【终点】标签"><i class="fa-solid fa-arrows-left-right-to-line"></i> 范围连选</button>
                                <button id="tm-confirm-batch-delete" class="menu_button" style="margin:0; font-size:11px; padding:2px 10px; background:rgba(220,53,69,0.3) !important; color:#ff8888 !important; white-space:nowrap;" disabled><i class="fa-solid fa-trash"></i> 确认删除选中</button>
                                <button id="tm-cancel-batch-delete" class="menu_button" style="margin:0; font-size:11px; padding:2px 8px; white-space:nowrap;">退出批量</button>
                            </div>
                        </div>
                        <div style="margin-bottom:15px; display:flex; gap:8px; align-items:center;">
                            <input type="text" id="new-tag-name" class="text_pole" placeholder="${subtagsEnabled ? '新一级标签名称...' : '新标签名称...'}" style="flex-grow:1; min-width:0;">
                            <button id="add-new-tag-btn" class="menu_button" style="margin:0; white-space:nowrap; flex-shrink:0; width:auto;"><i class="fa-solid fa-plus"></i> ${subtagsEnabled ? '添加一级标签' : '添加标签'}</button>
                        </div>
                        <div id="tags-management-list" style="max-height: 380px; overflow-y:auto; padding-right:4px;"></div>
                        <div style="margin-top:10px; border-top:1px solid rgba(128,128,128,0.2); padding-top:10px;">
                            <button id="apply-keyword-mappings-btn" class="menu_button" style="width:100%; justify-content:center;"><i class="fa-solid fa-wand-magic-sparkles"></i> 对所有现有美化重新应用关键词映射</button>
                        </div>
                    `;

                    await ctx.callGenericPopup(popupHtml, 'confirm', null, {
                        title: '管理标签',
                        okButton: '关闭',
                        cancelButton: '取消',
                        wide: true,
                        onOpen: (popup) => {
                            const dlg = popup.dlg;

                            const renderList = () => {
                                const listContainer = dlg.querySelector('#tags-management-list');
                                if (!listContainer) return;

                                const batchBar = dlg.querySelector('#tm-batch-delete-bar');
                                if (batchBar) batchBar.style.display = isBatchDeleteMode ? 'flex' : 'none';

                                const validThemeNames = getValidInstalledThemeNames();
                                const filterValid = (arr) => validThemeNames.size > 0 ? (arr || []).filter(t => validThemeNames.has(t)) : (arr || []);

                                if (!subtagsEnabled) {
                                    let html = '<ul style="list-style:none; padding:0; margin:0;">';
                                    tags.forEach((t, idx) => {
                                        const kwCount = t.keywords ? t.keywords.length : 0;
                                        const isChecked = selectedTagIds.has(t.id);
                                        html += `
                                            <li class="tm-flat-tag-item" data-id="${t.id}" data-index="${idx}" style="display:flex; justify-content:space-between; padding:6px 8px; background:rgba(255,255,255,0.04); margin-bottom:4px; border-radius:4px; align-items:center;">
                                                <div style="display:flex; align-items:center; gap:6px; min-width:0; flex:1; overflow:hidden;">
                                                    ${isBatchDeleteMode ? `<input type="checkbox" class="tm-batch-tag-chk" data-id="${t.id}" ${isChecked ? 'checked' : ''} style="margin:0;">` : ''}
                                                    <i class="fa-solid fa-tag" style="opacity:0.7; font-size:11px; flex-shrink:0;"></i>
                                                    <span style="word-break: break-all; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${escapeHtml(t.name)}</span>
                                                    <small style="opacity:0.6; flex-shrink:0; white-space:nowrap;">(${filterValid(t.themes).length})</small>
                                                    ${kwCount > 0 ? `<small style="opacity:0.5; flex-shrink:0; white-space:nowrap;">[${kwCount}词]</small>` : ''}
                                                </div>
                                                <div style="display:flex; gap:3px; align-items:center; flex-shrink:0;">
                                                    <button class="menu_button move-flat-up tm-btn-icon-only" data-id="${t.id}" title="向上移动" ${idx === 0 ? 'disabled style="opacity:0.3;"' : ''}><i class="fa-solid fa-arrow-up"></i></button>
                                                    <button class="menu_button move-flat-down tm-btn-icon-only" data-id="${t.id}" title="向下移动" ${idx === tags.length - 1 ? 'disabled style="opacity:0.3;"' : ''}><i class="fa-solid fa-arrow-down"></i></button>
                                                    <button class="menu_button keywords-tag-inline tm-btn-icon-only" data-id="${t.id}" title="编辑关键词映射"><i class="fa-solid fa-key"></i></button>
                                                    <button class="menu_button rename-tag-inline tm-btn-icon-only" data-id="${t.id}" title="重命名"><i class="fa-solid fa-pen"></i></button>
                                                    <button class="menu_button delete-tag-inline tm-btn-icon-only" data-id="${t.id}" title="删除"><i class="fa-solid fa-trash"></i></button>
                                                </div>
                                            </li>
                                        `;
                                    });
                                    html += '</ul>';
                                    listContainer.innerHTML = html;
                                } else {
                                    let html = '<div class="tm-subtags-tree">';
                                    const rootTags = tags.filter(t => !t.parentId || !tags.some(p => p.id === t.parentId));

                                    const renderSubtagTreeNodeHTML = (nodeTag, depth, siblings, idx) => {
                                        const childTags = tags.filter(t => t.parentId === nodeTag.id);
                                        const isChecked = selectedTagIds.has(nodeTag.id);
                                        const kwCount = nodeTag.keywords ? nodeTag.keywords.length : 0;
                                        const themeCount = filterValid(nodeTag.themes).length;

                                        let nodeHtml = `
                                            <div class="tm-tree-node-card" data-id="${nodeTag.id}" data-depth="${depth}" style="margin-left:${depth * 16}px; margin-bottom:4px;">
                                                <div class="tm-tree-node-header" data-id="${nodeTag.id}" style="display:flex; justify-content:space-between; padding:5px 8px; background:${depth === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)'}; border-radius:4px; align-items:center; border:1px solid rgba(128,128,128,0.15);">
                                                    <div style="display:flex; align-items:center; gap:6px; min-width:0; flex:1; overflow:hidden;">
                                                        ${isBatchDeleteMode ? `<input type="checkbox" class="tm-batch-tag-chk" data-id="${nodeTag.id}" ${isChecked ? 'checked' : ''} style="margin:0;">` : ''}
                                                        <i class="${depth === 0 ? 'fa-solid fa-folder-open' : 'fa-solid fa-tag'}" style="${depth === 0 ? 'color:var(--SmartThemeQuoteColor, #4a90e2);' : 'opacity:0.7; font-size:11px;'} flex-shrink:0;"></i>
                                                        <span style="font-weight:${depth === 0 ? 'bold' : 'normal'}; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${escapeHtml(nodeTag.name)}</span>
                                                        <small style="opacity:0.6; flex-shrink:0; white-space:nowrap;">(${childTags.length > 0 ? `子级:${childTags.length}/` : ''}主题:${themeCount})</small>
                                                        ${kwCount > 0 ? `<small style="opacity:0.5; flex-shrink:0; white-space:nowrap;">[${kwCount}词]</small>` : ''}
                                                    </div>
                                                    <div style="display:flex; gap:3px; align-items:center; flex-shrink:0;">
                                                        <button class="menu_button move-node-up tm-btn-icon-only" data-id="${nodeTag.id}" title="向上移动" ${idx === 0 ? 'disabled style="opacity:0.3;"' : ''}><i class="fa-solid fa-arrow-up"></i></button>
                                                        <button class="menu_button move-node-down tm-btn-icon-only" data-id="${nodeTag.id}" title="向下移动" ${idx === siblings.length - 1 ? 'disabled style="opacity:0.3;"' : ''}><i class="fa-solid fa-arrow-down"></i></button>
                                                        <button class="menu_button add-subtag-btn tm-btn-icon-only" data-id="${nodeTag.id}" title="添加子标签"><i class="fa-solid fa-plus"></i></button>
                                                        ${depth > 0 ? `<button class="menu_button promote-tag-inline tm-btn-icon-only" data-id="${nodeTag.id}" title="升一级 (提升给父级的父级)"><i class="fa-solid fa-turn-up"></i></button>` : ''}
                                                        <button class="menu_button keywords-tag-inline tm-btn-icon-only" data-id="${nodeTag.id}" title="编辑关键词映射"><i class="fa-solid fa-key"></i></button>
                                                        <button class="menu_button rename-tag-inline tm-btn-icon-only" data-id="${nodeTag.id}" title="重命名"><i class="fa-solid fa-pen"></i></button>
                                                        <button class="menu_button delete-tag-inline tm-btn-icon-only" data-id="${nodeTag.id}" title="删除"><i class="fa-solid fa-trash"></i></button>
                                                    </div>
                                                </div>
                                                <div class="tm-tree-node-children" data-parent-id="${nodeTag.id}">
                                        `;

                                        childTags.forEach((cTag, cIdx) => {
                                            nodeHtml += renderSubtagTreeNodeHTML(cTag, depth + 1, childTags, cIdx);
                                        });

                                        nodeHtml += `</div></div>`;
                                        return nodeHtml;
                                    };

                                    rootTags.forEach((rTag, rIdx) => {
                                        html += renderSubtagTreeNodeHTML(rTag, 0, rootTags, rIdx);
                                    });

                                    html += '</div>';
                                    listContainer.innerHTML = html;
                                }

                                BindEvents();
                            };

                            let lastCheckedIdx = -1;
                            let isMobileRangeActive = false;
                            let mobileRangeStartIdx = -1;

                            const updateBatchCount = () => {
                                const countEl = dlg.querySelector('#tm-batch-tag-count');
                                const totalEl = dlg.querySelector('#tm-batch-tag-total');
                                const confirmBtn = dlg.querySelector('#tm-confirm-batch-delete');
                                if (countEl) countEl.textContent = selectedTagIds.size;
                                if (totalEl) totalEl.textContent = tags.length;
                                if (confirmBtn) {
                                    confirmBtn.disabled = selectedTagIds.size === 0;
                                    confirmBtn.style.opacity = selectedTagIds.size === 0 ? '0.4' : '1';
                                }
                            };

                            const handleTagCheckClick = (chk, idx, e) => {
                                const id = chk.dataset.id;
                                const isChecked = chk.checked;
                                const allChks = Array.from(dlg.querySelectorAll('.tm-batch-tag-chk'));
                                const batchRangeBtn = dlg.querySelector('#tm-batch-tag-range-select');

                                // 1. 移动端/触摸屏“起点 ➔ 终点”范围连选模式
                                if (isMobileRangeActive) {
                                    if (mobileRangeStartIdx === -1) {
                                        mobileRangeStartIdx = idx;
                                        const startTag = tags.find(t => t.id === id);
                                        toastr.info(`📍 起点已锁定：「${startTag ? startTag.name : '未知'}」，请点选【终点标签】`);
                                        chk.checked = true;
                                        selectedTagIds.add(id);
                                    } else {
                                        const start = Math.min(mobileRangeStartIdx, idx);
                                        const end = Math.max(mobileRangeStartIdx, idx);
                                        let selectCount = 0;
                                        for (let i = start; i <= end; i++) {
                                            const targetChk = allChks[i];
                                            if (targetChk) {
                                                targetChk.checked = true;
                                                selectedTagIds.add(targetChk.dataset.id);
                                                selectCount++;
                                            }
                                        }
                                        toastr.success(`🎉 范围连选完成！已自动勾选 ${selectCount} 个标签！`);
                                        isMobileRangeActive = false;
                                        mobileRangeStartIdx = -1;
                                        if (batchRangeBtn) {
                                            batchRangeBtn.style.background = '';
                                            batchRangeBtn.style.color = '';
                                        }
                                    }
                                    updateBatchCount();
                                    return;
                                }

                                // 2. 桌面端 Shift 键连选模式
                                if (e && e.shiftKey && lastCheckedIdx !== -1) {
                                    const start = Math.min(lastCheckedIdx, idx);
                                    const end = Math.max(lastCheckedIdx, idx);

                                    for (let i = start; i <= end; i++) {
                                        const targetChk = allChks[i];
                                        if (targetChk) {
                                            targetChk.checked = isChecked;
                                            const tid = targetChk.dataset.id;
                                            if (isChecked) {
                                                selectedTagIds.add(tid);
                                            } else {
                                                selectedTagIds.delete(tid);
                                            }
                                        }
                                    }
                                } else {
                                    if (isChecked) {
                                        selectedTagIds.add(id);
                                    } else {
                                        selectedTagIds.delete(id);
                                    }
                                }

                                lastCheckedIdx = idx;
                                updateBatchCount();
                            };

                            const BindEvents = () => {
                                // 批量勾选与 Shift 连选逻辑
                                const allChks = Array.from(dlg.querySelectorAll('.tm-batch-tag-chk'));
                                allChks.forEach((chk, idx) => {
                                    chk.setAttribute('data-order-idx', idx);

                                    chk.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        handleTagCheckClick(chk, idx, e);
                                    });
                                });

                                // 移动端整行大区域触控勾选辅助
                                if (isBatchDeleteMode) {
                                    dlg.querySelectorAll('.tm-flat-tag-item, .tm-level1-header, .tm-level2-item').forEach(row => {
                                        row.style.cursor = 'pointer';
                                        row.addEventListener('click', (e) => {
                                            if (e.target.closest('.tm-btn-icon-only') || e.target.classList.contains('tm-batch-tag-chk')) return;
                                            const chk = row.querySelector('.tm-batch-tag-chk');
                                            if (chk) {
                                                const idx = parseInt(chk.getAttribute('data-order-idx'));
                                                chk.checked = !chk.checked;
                                                handleTagCheckClick(chk, idx, e);
                                            }
                                        });
                                    });
                                }
                                // 删除
                                dlg.querySelectorAll('.delete-tag-inline').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const id = e.currentTarget.dataset.id;
                                        if (confirm('确定删除此标签吗？(不会删除主题本身)')) {
                                            const targetTag = tags.find(t => t.id === id);
                                            const affectedThemes = targetTag && targetTag.themes ? [...targetTag.themes] : [];
                                            tags.forEach(t => {
                                                if (t.parentId === id) t.parentId = null;
                                            });
                                            tags = tags.filter(t => t.id !== id);
                                            saveThemeTags(tags);
                                            renderList();
                                            softRefreshUI(affectedThemes);
                                        }
                                    });
                                });

                                // 重命名
                                dlg.querySelectorAll('.rename-tag-inline').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const id = e.currentTarget.dataset.id;
                                        const tag = tags.find(t => t.id === id);
                                        if (!tag) return;
                                        const newName = prompt('输入新名称:', tag.name);
                                        if (newName && newName.trim() && newName.trim() !== tag.name) {
                                            tag.name = newName.trim();
                                            saveThemeTags(tags);
                                            renderList();
                                            softRefreshUI(tag.themes || []);
                                        }
                                    });
                                });

                                // 关键词高级管理弹窗
                                dlg.querySelectorAll('.keywords-tag-inline').forEach(btn => {
                                    btn.addEventListener('click', async (e) => {
                                        e.stopPropagation();
                                        const id = e.currentTarget.dataset.id;
                                        const tag = tags.find(t => t.id === id);
                                        if (!tag) return;

                                        await openTagKeywordsModal(tag, (updatedTag, autoApply) => {
                                            saveThemeTags(tags);
                                            renderList();
                                            if (autoApply) {
                                                applyKeywordMappings();
                                            }
                                            toastr.success(`已更新标签「${updatedTag.name}」的关键词映射`);
                                        });
                                    });
                                });

                                // 添加二级标签
                                dlg.querySelectorAll('.add-subtag-btn').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const parentId = e.currentTarget.dataset.id;
                                        const parentTag = tags.find(t => t.id === parentId);
                                        const subName = prompt(`为一级目录「${parentTag ? parentTag.name : ''}」添加二级标签名称:`);
                                        if (subName && subName.trim()) {
                                            const name = subName.trim();
                                            if (tags.some(t => t.name === name && t.parentId === parentId)) {
                                                toastr.warning('该一级目录已存在同名二级标签');
                                                return;
                                            }
                                            tags.push({ id: Date.now().toString(), name: name, parentId: parentId, themes: [], keywords: [] });
                                            saveThemeTags(tags);
                                            renderList();
                                            softRefreshUI([]);
                                        }
                                    });
                                });

                                // 提升标签层级 (升一级)
                                dlg.querySelectorAll('.promote-tag-inline').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const id = e.currentTarget.dataset.id;
                                        const tag = tags.find(t => t.id === id);
                                        if (tag && tag.parentId) {
                                            const parentTag = tags.find(p => p.id === tag.parentId);
                                            tag.parentId = parentTag ? parentTag.parentId || null : null;
                                            saveThemeTags(tags);
                                            renderList();
                                            softRefreshUI([]);
                                            toastr.success(`已提升标签「${tag.name}」的层级`);
                                        }
                                    });
                                });

                                // 上下移动节点按钮事件 (N-Level 通用)
                                dlg.querySelectorAll('.move-node-up').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const id = e.currentTarget.dataset.id;
                                        const tag = tags.find(t => t.id === id);
                                        if (!tag) return;
                                        const siblings = tags.filter(t => t.parentId === tag.parentId);
                                        const sIdx = siblings.findIndex(t => t.id === id);
                                        if (sIdx > 0) {
                                            const srcTag = siblings[sIdx];
                                            const tgtTag = siblings[sIdx - 1];
                                            const posA = tags.indexOf(srcTag);
                                            const posB = tags.indexOf(tgtTag);
                                            if (posA > -1 && posB > -1) {
                                                const [moved] = tags.splice(posA, 1);
                                                tags.splice(posB, 0, moved);
                                                saveThemeTags(tags);
                                                renderList();
                                                softRefreshUI();
                                            }
                                        }
                                    });
                                });

                                dlg.querySelectorAll('.move-node-down').forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        const id = e.currentTarget.dataset.id;
                                        const tag = tags.find(t => t.id === id);
                                        if (!tag) return;
                                        const siblings = tags.filter(t => t.parentId === tag.parentId);
                                        const sIdx = siblings.findIndex(t => t.id === id);
                                        if (sIdx > -1 && sIdx < siblings.length - 1) {
                                            const srcTag = siblings[sIdx];
                                            const tgtTag = siblings[sIdx + 1];
                                            const posA = tags.indexOf(srcTag);
                                            const posB = tags.indexOf(tgtTag);
                                            if (posA > -1 && posB > -1) {
                                                const [moved] = tags.splice(posA, 1);
                                                tags.splice(posB, 0, moved);
                                                saveThemeTags(tags);
                                                renderList();
                                                softRefreshUI();
                                            }
                                        }
                                    });
                                });
                            };

                            const batchModeBtn = dlg.querySelector('#batch-delete-tags-mode-btn');
                            if (batchModeBtn) {
                                batchModeBtn.addEventListener('click', () => {
                                    isBatchDeleteMode = !isBatchDeleteMode;
                                    if (!isBatchDeleteMode) selectedTagIds.clear();
                                    renderList();
                                });
                            }

                            const batchSelectAllBtn = dlg.querySelector('#tm-batch-tag-select-all');
                            if (batchSelectAllBtn) {
                                batchSelectAllBtn.addEventListener('click', () => {
                                    if (selectedTagIds.size === tags.length && tags.length > 0) {
                                        selectedTagIds.clear();
                                    } else {
                                        tags.forEach(t => selectedTagIds.add(t.id));
                                    }
                                    renderList();
                                    updateBatchCount();
                                });
                            }

                            const batchInvertBtn = dlg.querySelector('#tm-batch-tag-invert-select');
                            if (batchInvertBtn) {
                                batchInvertBtn.addEventListener('click', () => {
                                    tags.forEach(t => {
                                        if (selectedTagIds.has(t.id)) {
                                            selectedTagIds.delete(t.id);
                                        } else {
                                            selectedTagIds.add(t.id);
                                        }
                                    });
                                    renderList();
                                    updateBatchCount();
                                });
                            }

                            const batchRangeBtn = dlg.querySelector('#tm-batch-tag-range-select');
                            if (batchRangeBtn) {
                                batchRangeBtn.addEventListener('click', () => {
                                    isMobileRangeActive = !isMobileRangeActive;
                                    mobileRangeStartIdx = -1;
                                    if (isMobileRangeActive) {
                                        batchRangeBtn.style.background = 'var(--SmartThemeQuoteColor, #007bff)';
                                        batchRangeBtn.style.color = '#ffffff';
                                        toastr.info('👉 范围连选模式已开启：请在列表中依次点选【起点标签】和【终点标签】');
                                    } else {
                                        batchRangeBtn.style.background = '';
                                        batchRangeBtn.style.color = '';
                                        toastr.info('已退出范围连选模式');
                                    }
                                });
                            }

                            const cancelBatchDeleteBtn = dlg.querySelector('#tm-cancel-batch-delete');
                            if (cancelBatchDeleteBtn) {
                                cancelBatchDeleteBtn.addEventListener('click', () => {
                                    isBatchDeleteMode = false;
                                    selectedTagIds.clear();
                                    renderList();
                                });
                            }

                            const confirmBatchDeleteBtn = dlg.querySelector('#tm-confirm-batch-delete');
                            if (confirmBatchDeleteBtn) {
                                confirmBatchDeleteBtn.addEventListener('click', () => {
                                    if (selectedTagIds.size === 0) return;
                                    if (confirm(`确定要批量删除选中的 ${selectedTagIds.size} 个标签吗？(删除标签不会影响美化主题本身)`)) {
                                        const removeSet = new Set(selectedTagIds);
                                        tags.forEach(t => {
                                            if (removeSet.has(t.parentId)) t.parentId = null;
                                        });
                                        tags = tags.filter(t => !removeSet.has(t.id));
                                        saveThemeTags(tags);
                                        selectedTagIds.clear();
                                        isBatchDeleteMode = false;
                                        renderList();
                                        softRefreshUI();
                                        toastr.success('已成功批量删除选中的标签！');
                                    }
                                });
                            }

                            const chkSubtags = dlg.querySelector('#chk-enable-subtags');
                            if (chkSubtags) {
                                chkSubtags.addEventListener('change', () => {
                                    subtagsEnabled = chkSubtags.checked;
                                    localStorage.setItem(ENABLE_SUBTAGS_KEY, subtagsEnabled ? 'true' : 'false');
                                    const input = dlg.querySelector('#new-tag-name');
                                    const addBtn = dlg.querySelector('#add-new-tag-btn');
                                    if (input) input.placeholder = subtagsEnabled ? '新一级标签名称...' : '新标签名称...';
                                    if (addBtn) addBtn.innerHTML = subtagsEnabled ? '<i class="fa-solid fa-plus"></i> 添加一级标签' : '<i class="fa-solid fa-plus"></i> 添加标签';
                                    renderList();
                                    softRefreshUI();
                                });
                            }

                            dlg.querySelector('#add-new-tag-btn').addEventListener('click', () => {
                                const input = dlg.querySelector('#new-tag-name');
                                const name = input.value.trim();
                                if (!name) return;
                                if (tags.some(t => t.name === name && !t.parentId)) {
                                    toastr.warning('同名标签已存在');
                                    return;
                                }
                                tags.push({ id: Date.now().toString(), name: name, parentId: null, themes: [], keywords: [] });
                                saveThemeTags(tags);
                                input.value = '';
                                renderList();
                                softRefreshUI();
                            });

                            const applyMappingsBtn = dlg.querySelector('#apply-keyword-mappings-btn');
                            if (applyMappingsBtn) {
                                applyMappingsBtn.addEventListener('click', () => {
                                    const applied = applyKeywordMappings();
                                    if (applied) {
                                        toastr.success('关键词映射已重新应用！');
                                    } else {
                                        toastr.info('没有找到新的匹配，或尚未设置关键词。');
                                    }
                                });
                            }

                            const modalAutoGroupBtn = dlg.querySelector('#modal-auto-group-btn');
                            if (modalAutoGroupBtn) {
                                modalAutoGroupBtn.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    popup.close();
                                    openAutoGroupWizard();
                                });
                            }

                            renderList();
                        }
                    });
                }

                