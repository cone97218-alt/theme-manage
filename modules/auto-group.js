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

export function extractCandidateThemeGroups(themePool, minMatch = 2, targetLevel = 'l1', parentId = null, maxCandidates = 200) {
                    const list = themePool || allParsedThemes || [];
                    const candidateMap = new Map(); // kw -> Set(themeValue)

                    // 0. 收集同级已存在的标签名，若已存在同名标签则自动跳过
                    const existingTags = loadThemeTags();
                    const existingTagNamesAtLevel = new Set(
                        existingTags
                            .filter(t => (targetLevel === 'l2' ? t.parentId === parentId : (!t.parentId || !existingTags.some(p => p.id === t.parentId))))
                            .map(t => t.name.trim().toLowerCase())
                    );

                    // 辅助：清洗主题名称中的版本号、各种类型括号、数字、常见后缀
                    function sanitizeThemeTitle(rawName) {
                        if (!rawName) return '';
                        return rawName
                            .replace(/[\[\]【】（）()《》<>\{\}]/g, ' ')
                            .replace(/\bv?\d+(\.\d+)*\b/gi, ' ')
                            .replace(/[_\-\+\/\\]+/g, ' ')
                            .trim();
                    }

                    // 1. 策略 A: 匹配各类括号里面的独立标记词（如 【黑金】 [Cyberpunk] (莫兰迪) 《动漫》）
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

                    // 2. 策略 B: 分词 Token 提取 (按空格分隔)
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

                    // 策略 D: 3位及以上纯数字标识/型号/ID提取 (如 "1445", "2024", "8080" 等独立编号)
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

                    // 3. 策略 C: N-Gram 任意位置连续子串滑动提取 (解决无空格中文/复合词位置不同、数字后缀干扰问题，如 "播放器", "聊天框", "莫兰迪")
                    const nGramMap = new Map(); // kw -> Set(themeValue)

                    list.forEach(t => {
                        const name = t.display || t.value;
                        if (!name) return;
                        
                        // 移除非中英文字符、数字，保留纯中英字串
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

                    // 合并 N-gram 抽取结果至 candidateMap，并通过位置无关的模糊匹配检索全量美化
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

                    // 4. 转换为数组并按门槛筛选
                    let candidateList = [];
                    candidateMap.forEach((themesSet, kw) => {
                        if (themesSet.size >= minMatch) {
                            candidateList.push({
                                keyword: kw,
                                themes: Array.from(themesSet)
                            });
                        }
                    });

                    // 5. 智能归并与去重 (Smart Subsumption & Overlap Merging)
                    // 优先按字串长度降序排序（较长且有特异性的词优先，如 "播放器" 优于 "播放"）
                    candidateList.sort((a, b) => b.keyword.length - a.keyword.length);

                    const finalCandidates = [];
                    
                    for (const item of candidateList) {
                        const kwLower = item.keyword.toLowerCase();
                        
                        // 检测是否有更长且美化包含率 ≥ 70% 的长词包含了当前短词
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

                    // 6. Jaccard 相似度高度重合去重：若两个候选词的美化集合 Jaccard ≥ 0.75，保留较长（更具体）的那个
                    const jaccardDeduped = [];
                    for (const item of finalCandidates) {
                        const itemSet = new Set(item.themes);
                        const isDuplicate = jaccardDeduped.some(existing => {
                            const existingSet = new Set(existing.themes);
                            const intersection = item.themes.filter(t => existingSet.has(t)).length;
                            const union = new Set([...item.themes, ...existing.themes]).size;
                            if (union === 0) return false;
                            const jaccard = intersection / union;
                            if (jaccard >= 0.75) {
                                // 保留关键词更长（更具体）的那个
                                if (existing.keyword.length < item.keyword.length) {
                                    existing.keyword = item.keyword;
                                }
                                return true;
                            }
                            return false;
                        });
                        if (!isDuplicate) jaccardDeduped.push(item);
                    }

                    // 7. 价值评分排序：优先展示「独特贡献度高」的候选词（能归类更多别处未覆盖美化的词排前）
                    const coveredByPrev = new Set();
                    jaccardDeduped.sort((a, b) => b.themes.length - a.themes.length);
                    jaccardDeduped.forEach(item => {
                        const newCount = item.themes.filter(t => !coveredByPrev.has(t)).length;
                        item._valueScore = newCount + item.themes.length * 0.1;
                        item.themes.forEach(t => coveredByPrev.add(t));
                    });
                    jaccardDeduped.sort((a, b) => b._valueScore - a._valueScore);

                    // 8. 按 maxCandidates 弹性截取
                    if (maxCandidates && maxCandidates > 0 && isFinite(maxCandidates)) {
                        return jaccardDeduped.slice(0, maxCandidates);
                    }
                    return jaccardDeduped;
                }

                // === 分组向导 Step 1: 设置基数范围、目标层级与门槛 ===
                export async function openAutoGroupWizard() {
                    if (!allParsedThemes || allParsedThemes.length === 0) {
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

                    let allTagsSelectOptionsHtml = existingTags.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${t.themes ? t.themes.length : 0})</option>`).join('');
                    if (!allTagsSelectOptionsHtml) {
                        allTagsSelectOptionsHtml = '<option value="">(暂无已选标签)</option>';
                    }

                    const selectedCount = selectedForBatch ? selectedForBatch.size : 0;
                    const filteredCount = typeof filteredThemes !== 'undefined' ? filteredThemes.length : allParsedThemes.length;
                    const scopeFilteredLabel = selectedCount > 0 ? `当前批量勾选的美化 (共 ${selectedCount} 个)` : `当前界面已筛选的美化 (共 ${filteredCount} 个)`;

                    const setupHtml = `
                        <div style="padding:4px; height:100%; display:flex; flex-direction:column; box-sizing:border-box;">
                            <h4 style="margin:0 0 10px 0; color:var(--SmartThemeQuoteColor, #4a90e2); display:flex; align-items:center; gap:6px;">
                                <i class="fa-solid fa-wand-magic-sparkles" style="color:#ffc107;"></i> 智能美化分组向导
                            </h4>
                            <div style="background:rgba(255,255,255,0.04); border-radius:6px; padding:16px; flex:1; display:flex; flex-direction:column; gap:16px; overflow-y:auto;">
                                <div>
                                    <div style="font-size:13px; font-weight:bold; margin-bottom:8px; color:var(--SmartThemeQuoteColor, #4a90e2); display:flex; align-items:center; gap:6px;">
                                        <i class="fa-solid fa-layer-group"></i> 1. 选择分析的美化基数范围：
                                    </div>
                                    <div style="display:flex; flex-direction:column; gap:8px; padding-left:12px;">
                                        <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                                            <input type="radio" name="tm-auto-scope" value="all" checked style="margin:0;">
                                            <span>全部美化主题 (共 <b>${allParsedThemes.length}</b> 个)</span>
                                        </label>
                                        <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                                            <input type="radio" name="tm-auto-scope" value="filtered" style="margin:0;">
                                            <span>${scopeFilteredLabel}</span>
                                        </label>
                                        <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                                            <input type="radio" name="tm-auto-scope" value="tag" style="margin:0;">
                                            <span>特定标签下的美化</span>
                                        </label>
                                        <div id="tm-auto-scope-tag-container" style="margin-left:24px; display:none;">
                                            <select id="tm-auto-scope-tag-select" class="text_pole" style="font-size:12px; height:30px; padding:2px 8px; width:100%; max-width:280px;">
                                                ${allTagsSelectOptionsHtml}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                <hr style="border:0; border-top:1px solid rgba(128,128,128,0.2); margin:0;">
                                <div>
                                    <div style="font-size:13px; font-weight:bold; margin-bottom:8px; color:var(--SmartThemeQuoteColor, #4a90e2); display:flex; align-items:center; gap:6px;">
                                        <i class="fa-solid fa-sitemap"></i> 2. 选择生成标签的目标层级：
                                    </div>
                                    <div style="display:flex; flex-direction:column; gap:8px; padding-left:12px;">
                                        <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                                            <input type="radio" name="tm-auto-level" value="l1" checked style="margin:0;">
                                            <span>创建为 <b>一级主标签/分类</b></span>
                                        </label>
                                        <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                                            <input type="radio" name="tm-auto-level" value="l2" style="margin:0;">
                                            <span>创建为 <b>二级子标签</b> (支持向归属主分类融合/合并)</span>
                                        </label>
                                        <div id="tm-auto-parent-container" style="margin-left:24px; display:none;">
                                            <select id="tm-auto-parent-select" class="text_pole" style="font-size:12px; height:30px; padding:2px 8px; width:100%; max-width:280px;">
                                                ${l1SelectOptionsHtml}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                <hr style="border:0; border-top:1px solid rgba(128,128,128,0.2); margin:0;">
                                <div>
                                    <div style="font-size:13px; font-weight:bold; margin-bottom:8px; color:var(--SmartThemeQuoteColor, #4a90e2); display:flex; align-items:center; gap:6px;">
                                        <i class="fa-solid fa-filter"></i> 3. 提取门槛：
                                    </div>
                                    <div style="display:inline-flex; align-items:center; gap:8px; font-size:13px; padding-left:12px;">
                                        <span>至少重合包含：</span>
                                        <input type="number" id="tm-auto-min-match" class="text_pole" value="2" min="2" max="50" style="width:60px; text-align:center; height:28px; padding:0; margin:0;">
                                        <span>个美化主题</span>
                                    </div>
                                </div>
                                <hr style="border:0; border-top:1px solid rgba(128,128,128,0.2); margin:0;">
                                <div>
                                    <div style="font-size:13px; font-weight:bold; margin-bottom:8px; color:var(--SmartThemeQuoteColor, #4a90e2); display:flex; align-items:center; gap:6px;">
                                        <i class="fa-solid fa-list-ol"></i> 4. 提取分类上限 (海量美化专用)：
                                    </div>
                                    <div style="display:inline-flex; align-items:center; gap:8px; font-size:13px; padding-left:12px; flex-wrap:wrap;">
                                        <span>提取候选上限：</span>
                                        <select id="tm-auto-max-candidates" class="text_pole" style="font-size:12px; height:28px; padding:2px 8px; width:170px; margin:0;">
                                            <option value="100">100 组 (默认推荐)</option>
                                            <option value="200" selected>200 组 (深度提取)</option>
                                            <option value="500">500 组 (海量美化推荐)</option>
                                            <option value="0">🚀 全量全景提取 (不限组数)</option>
                                        </select>
                                        <small style="opacity:0.65;">(不限组数可提取所有可能的分类组，结合全景矩阵审核一键全选清理)</small>
                                    </div>
                                </div>
                                <hr style="border:0; border-top:1px solid rgba(128,128,128,0.2); margin:0;">
                                <div>
                                    <div style="font-size:13px; font-weight:bold; margin-bottom:8px; color:var(--SmartThemeQuoteColor, #4a90e2); display:flex; align-items:center; gap:6px;">
                                        <i class="fa-solid fa-filter-circle-xmark"></i> 5. 智能过滤：
                                    </div>
                                    <div style="display:flex; flex-direction:column; gap:8px; padding-left:12px;">
                                        <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                                            <input type="checkbox" id="tm-auto-untagged-only" style="margin:0;">
                                            <span>🎯 仅分析<b>未归类</b>的美化 (跳过已有标签覆盖的美化，专注新增内容)</span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;

                    let selectedScope = 'all';
                    let selectedLevel = 'l1';
                    let parentId = null;
                    let minMatch = 2;
                    let maxCandidates = 200;
                    let untaggedOnly = false;

                    const popupRes = await ctx.callGenericPopup(setupHtml, 'confirm', null, {
                        title: '分组提取设置',
                        okButton: '▶ 开始分析提取',
                        cancelButton: '✕ 取消',
                        wide: true,
                        onOpen: (popup) => {
                            const dlg = popup.dlg;
                            if (dlg) {
                                dlg.style.width = '80vw';
                                dlg.style.height = '80vh';
                                dlg.style.maxWidth = '900px';
                                dlg.style.maxHeight = '80vh';
                                dlg.style.display = 'flex';
                                dlg.style.flexDirection = 'column';
                            }

                            const scopeRadios = dlg.querySelectorAll('input[name="tm-auto-scope"]');
                            const scopeTagContainer = dlg.querySelector('#tm-auto-scope-tag-container');
                            scopeRadios.forEach(r => {
                                r.addEventListener('change', () => {
                                    if (r.checked) selectedScope = r.value;
                                    scopeTagContainer.style.display = (selectedScope === 'tag') ? 'block' : 'none';
                                });
                            });

                            const levelRadios = dlg.querySelectorAll('input[name="tm-auto-level"]');
                            const parentContainer = dlg.querySelector('#tm-auto-parent-container');
                            levelRadios.forEach(r => {
                                r.addEventListener('change', () => {
                                    if (r.checked) selectedLevel = r.value;
                                    parentContainer.style.display = (selectedLevel === 'l2') ? 'block' : 'none';
                                });
                            });

                            const minMatchInput = dlg.querySelector('#tm-auto-min-match');
                            const parentSelect = dlg.querySelector('#tm-auto-parent-select');
                            const maxCandidatesSelect = dlg.querySelector('#tm-auto-max-candidates');

                            dlg.addEventListener('change', () => {
                                const checkedScope = dlg.querySelector('input[name="tm-auto-scope"]:checked');
                                if (checkedScope) selectedScope = checkedScope.value;
                                const checkedLevel = dlg.querySelector('input[name="tm-auto-level"]:checked');
                                if (checkedLevel) selectedLevel = checkedLevel.value;
                                if (parentSelect) parentId = parentSelect.value;
                                if (minMatchInput) minMatch = parseInt(minMatchInput.value) || 2;
                                if (maxCandidatesSelect) maxCandidates = parseInt(maxCandidatesSelect.value);
                                const untaggedOnlyChk = dlg.querySelector('#tm-auto-untagged-only');
                                if (untaggedOnlyChk) untaggedOnly = untaggedOnlyChk.checked;
                            });
                        }
                    });

                    if (!popupRes) return;

                    const maxCandidatesSelectEl = document.querySelector('#tm-auto-max-candidates');
                    if (maxCandidatesSelectEl) maxCandidates = parseInt(maxCandidatesSelectEl.value);

                    const minMatchInputEl = document.querySelector('#tm-auto-min-match');
                    if (minMatchInputEl) minMatch = parseInt(minMatchInputEl.value) || 2;

                    const untaggedOnlyChkEl = document.querySelector('#tm-auto-untagged-only');
                    if (untaggedOnlyChkEl) untaggedOnly = untaggedOnlyChkEl.checked;

                    showLoader();
                    setTimeout(() => {
                        try {
                            let pool = [];
                            if (selectedScope === 'filtered') {
                                if (selectedForBatch && selectedForBatch.size > 0) {
                                    const set = new Set(selectedForBatch);
                                    pool = allParsedThemes.filter(t => set.has(t.value));
                                } else if (typeof filteredThemes !== 'undefined' && filteredThemes.length > 0) {
                                    pool = filteredThemes;
                                } else {
                                    pool = allParsedThemes;
                                }
                            } else if (selectedScope === 'tag') {
                                const scopeTagId = document.querySelector('#tm-auto-scope-tag-select')?.value;
                                const scopeTag = existingTags.find(tg => tg.id === scopeTagId);
                                if (scopeTag && scopeTag.themes) {
                                    const tagThemesSet = new Set(scopeTag.themes);
                                    pool = allParsedThemes.filter(t => tagThemesSet.has(t.value));
                                } else {
                                    pool = allParsedThemes;
                                }
                            } else {
                                pool = allParsedThemes;
                            }

                            // 5. 若勾选「仅分析未归类美化」，从池中过滤掉已被任何标签覆盖的美化
                            if (untaggedOnly) {
                                const allExistingTags = loadThemeTags();
                                const taggedThemeSet = new Set(allExistingTags.flatMap(t => t.themes || []));
                                pool = pool.filter(t => !taggedThemeSet.has(t.value));
                                if (pool.length === 0) {
                                    hideLoader();
                                    toastr.info('当前范围内所有美化均已被标签覆盖，无需再次分组！');
                                    return;
                                }
                            }

                            const candidates = extractCandidateThemeGroups(pool, minMatch, selectedLevel, parentId, maxCandidates);
                            hideLoader();

                            if (candidates.length === 0) {
                                toastr.info(`在选定的 ${pool.length} 个美化中，未分析到重合数 ≥ ${minMatch} 且未重复的词组分类。`);
                                return;
                            }

                            // 启动全景批量审核矩阵
                            openAutoGroupBatchMatrix(candidates, selectedLevel, parentId);
                        } catch (err) {
                            hideLoader();
                            console.error('分组提取失败:', err);
                            toastr.error('分组提取发生异常: ' + (err.message || err));
                        }
                    }, 150);
                }

                // === 方案 1: 全景批量审核矩阵 (包含响应式移动端 UI、实时重命名与一键批量应用) ===
                export async function openAutoGroupBatchMatrix(candidates, level, parentId) {
                    if (!candidates || candidates.length === 0) {
                        toastr.info('没有候选分组可供审核。');
                        return;
                    }

                    const targetLevelLabel = level === 'l2' ? '二级子标签' : '一级主标签';
                    const totalThemesCount = new Set(candidates.flatMap(c => c.themes)).size;

                    const matrixHtml = `
                        <div class="tm-matrix-container">
                            <div class="tm-matrix-header">
                                <span style="font-weight:bold; font-size:14px; color:var(--SmartThemeQuoteColor, #4a90e2); display:inline-flex; align-items:center; gap:6px; white-space:nowrap;">
                                    <i class="fa-solid fa-table-cells-large" style="color:#ffc107;"></i> 自动分组全景审核矩阵
                                </span>
                                <span style="font-size:12px; padding:3px 10px; border-radius:12px; background:rgba(0,123,255,0.18); color:#4dabf7; font-weight:bold; white-space:nowrap;">
                                    <i class="fa-solid fa-sitemap" style="margin-right:4px;"></i>${targetLevelLabel}
                                </span>
                            </div>

                            <div class="tm-matrix-toolbar">
                                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                    <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; cursor:pointer; user-select:none; white-space:nowrap; margin:0;">
                                        <input type="checkbox" id="matrix-select-all-chk" checked style="margin:0;">
                                        <span>全选/取消</span>
                                    </label>
                                    <input type="search" id="matrix-search-box" class="text_pole" placeholder="搜索候选分组或美化名..." style="font-size:12px; height:26px; padding:2px 8px; width:160px; margin:0; flex:1; min-width:100px;">
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
                                <button id="matrix-apply-all-btn" class="menu_button active" style="margin:0; font-size:12.5px; font-weight:bold; padding:5px 16px; background:var(--SmartThemeQuoteColor, #007bff) !important; color:#ffffff !important; white-space:nowrap;"><i class="fa-solid fa-circle-check"></i> 一键生成/应用已选分组 (<span id="matrix-apply-count">${candidates.length}</span>)</button>
                            </div>
                        </div>
                    `;

                    // 辅助函数：保存/更新/合并二级与一级标签但不重刷全量 DOM
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

                        if (parentId) {
                            let currPId = parentId;
                            const visited = new Set();
                            while (currPId && !visited.has(currPId)) {
                                visited.add(currPId);
                                const parentTagObj = tags.find(t => t.id === currPId);
                                if (parentTagObj) {
                                    if (!parentTagObj.themes) parentTagObj.themes = [];
                                    themesList.forEach(tn => {
                                        if (!parentTagObj.themes.includes(tn)) parentTagObj.themes.push(tn);
                                    });
                                    currPId = parentTagObj.parentId;
                                } else {
                                    break;
                                }
                            }
                        }

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

                             // 搜索过滤 (复合搜索)
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

                            // 排序
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
                                        // 'value' = 按原始顺序（提取时已按价值评分排）
                                        return parseInt(a.dataset.idx) - parseInt(b.dataset.idx);
                                    });
                                    cards.forEach(c => matrixList.appendChild(c));
                                });
                            }

                            // 合并选中候选词
                            if (mergeBtn && matrixList) {
                                mergeBtn.addEventListener('click', () => {
                                    const checkedCards = Array.from(matrixList.querySelectorAll('.tm-matrix-card')).filter(card => {
                                        const chk = card.querySelector('.matrix-group-chk');
                                        return chk && chk.checked;
                                    });
                                    if (checkedCards.length < 2) {
                                        toastr.warning('请先勾选 2 个或以上候选分组再进行合并！');
                                        return;
                                    }
                                    // 取第一个的名称作为合并后标签名
                                    const firstCard = checkedCards[0];
                                    const firstNameInput = firstCard.querySelector('.matrix-tag-name-input');
                                    const mergedName = firstNameInput ? firstNameInput.value.trim() : candidates[firstCard.dataset.idx]?.keyword || '合并标签';
                                    const newName = prompt(`将 ${checkedCards.length} 个分组合并为一个标签，请输入标签名：`, mergedName);
                                    if (!newName || !newName.trim()) return;

                                    // 合并所有美化到第一张卡片
                                    const mergedThemes = new Set();
                                    checkedCards.forEach(card => {
                                        const idx = card.dataset.idx;
                                        const c = candidates[idx];
                                        if (c) c.themes.forEach(t => mergedThemes.add(t));
                                    });

                                    // 更新第一张卡
                                    if (firstNameInput) firstNameInput.value = newName.trim();
                                    const firstIdx = firstCard.dataset.idx;
                                    if (candidates[firstIdx]) {
                                        candidates[firstIdx].themes = Array.from(mergedThemes);
                                        // 更新美化数量显示
                                        const countSpan = firstCard.querySelector('.fa-layer-group')?.parentElement;
                                        if (countSpan) countSpan.innerHTML = `<i class="fa-solid fa-layer-group" style="margin-right:3px;"></i>${mergedThemes.size}个美化`;
                                    }

                                    // 删除其余卡片
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
                                    closePopup(popup);
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
                                    toastr.success(`🎉 批量审核完成！成功创建/合并了 ${createdCount} 个标签分类，挂载了 ${totalAssignedThemes} 个美化关联！`);
                                    closePopup(popup);
                                });
                            }
                        }
                    });
                }

                // === 分组向导 Step 2: 逐个审核通过/不通过（支持 80% 大屏幕、最大公约数提取与子标签合并） ===
                export async function runAutoGroupReviewStep(candidates, currentIndex, level, parentId, createdTagsCount, assignedThemesCount, historyStack = []) {
                    if (currentIndex >= candidates.length) {
                        renderTagsUI();
                        updateActiveState();
                        toastr.success(`🎉 分组向导已完成！共创建/更新了 ${createdTagsCount} 个标签分类。`);
                        return;
                    }

                    const candidate = candidates[currentIndex];
                    const targetLevelLabel = level === 'l2' ? '二级子标签' : '一级主标签';
                    const MAX_INITIAL_THEMES = 25;
                    const initialThemes = candidate.themes.slice(0, MAX_INITIAL_THEMES);
                    const remainingThemes = candidate.themes.slice(MAX_INITIAL_THEMES);

                    const wizardHtml = `
                        <div class="tm-wizard-container" style="padding:4px; height:100%; display:flex; flex-direction:column; box-sizing:border-box; writing-mode:horizontal-tb !important;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid rgba(128,128,128,0.2); padding-bottom:8px; flex-wrap:nowrap; writing-mode:horizontal-tb !important;">
                                <span style="font-weight:bold; font-size:14px; color:var(--SmartThemeQuoteColor, #4a90e2); display:inline-flex; align-items:center; gap:6px; white-space:nowrap; writing-mode:horizontal-tb !important;">
                                    <i class="fa-solid fa-list-check" style="color:#ffc107;"></i> 审核分组向导 (${currentIndex + 1} / ${candidates.length})
                                </span>
                                <span style="font-size:12px; padding:3px 10px; border-radius:12px; background:rgba(0,123,255,0.18); color:#4dabf7; font-weight:bold; white-space:nowrap; writing-mode:horizontal-tb !important;">
                                    <i class="fa-solid fa-sitemap" style="margin-right:4px;"></i>${targetLevelLabel}
                                </span>
                            </div>
                            <div style="background:rgba(255,255,255,0.04); padding:12px; border-radius:6px; margin-bottom:10px; flex:1; display:flex; flex-direction:column; min-height:0; writing-mode:horizontal-tb !important;">
                                <div style="font-size:13px; font-weight:bold; margin-bottom:10px; display:flex; align-items:center; justify-content:space-between; flex-wrap:nowrap; gap:10px; writing-mode:horizontal-tb !important;">
                                    <label style="display:inline-flex; align-items:center; gap:6px; white-space:nowrap; writing-mode:horizontal-tb !important; margin:0; cursor:pointer;">
                                        <i class="fa-solid fa-tag" style="color:#ffc107;"></i>
                                        <span style="white-space:nowrap; writing-mode:horizontal-tb !important;">标签名称：</span>
                                        <input type="text" id="wizard-tag-name-input" class="text_pole" value="${escapeHtml(candidate.keyword)}" style="display:inline-block; width:220px; max-width:50vw; height:28px; padding:2px 8px; font-size:13px; margin:0; writing-mode:horizontal-tb !important;">
                                    </label>
                                    <span style="font-size:12px; font-weight:normal; opacity:0.85; white-space:nowrap; writing-mode:horizontal-tb !important; flex-shrink:0;">
                                        <i class="fa-solid fa-layer-group" style="margin-right:4px;"></i> 匹配 <b>${candidate.themes.length}</b> 个美化
                                    </span>
                                </div>
                                <div style="font-size:12px; opacity:0.8; margin-bottom:8px; display:flex; align-items:center; gap:4px; white-space:nowrap; writing-mode:horizontal-tb !important;">
                                    <i class="fa-solid fa-tags"></i>
                                    <span style="white-space:nowrap; writing-mode:horizontal-tb !important;">勾选需加入该标签的美化（支持多标签与已存在同名分类合并）：</span>
                                </div>
                                <div id="wizard-themes-container" style="flex:1; max-height:calc(80vh - 180px); overflow-y:auto; background:rgba(0,0,0,0.15); padding:8px; border-radius:4px; display:flex; flex-direction:column; gap:4px; writing-mode:horizontal-tb !important;">
                                    ${initialThemes.map(tName => `
                                        <label style="display:flex; flex-direction:row; align-items:center; gap:8px; font-size:12px; cursor:pointer; padding:4px 8px; background:rgba(255,255,255,0.02); border-radius:3px; user-select:none; white-space:nowrap; writing-mode:horizontal-tb !important;">
                                            <input type="checkbox" class="wizard-theme-chk" value="${escapeHtml(tName)}" checked style="margin:0;">
                                            <span style="word-break:break-all; writing-mode:horizontal-tb !important;">${escapeHtml(tName)}</span>
                                        </label>
                                    `).join('')}
                                    ${remainingThemes.length > 0 ? `
                                        <button id="wizard-load-more-btn" class="menu_button" style="margin:6px 0 0 0; font-size:11px; width:100%; justify-content:center; background:rgba(255,255,255,0.06); white-space:nowrap;"><i class="fa-solid fa-chevron-down"></i> 展开余下 ${remainingThemes.length} 个美化...</button>
                                    ` : ''}
                                </div>
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:nowrap; margin-top:6px; writing-mode:horizontal-tb !important;">
                                <div style="display:flex; gap:6px;">
                                    ${historyStack.length > 0 ? `
                                        <button id="wizard-undo-btn" class="menu_button" style="margin:0; font-size:11px; padding:4px 8px; background:rgba(255,193,7,0.2) !important; color:#ffc107 !important; white-space:nowrap;" title="撤销上一步操作并重写上个卡片"><i class="fa-solid fa-rotate-left"></i> 上一步</button>
                                    ` : ''}
                                    <button id="wizard-stop-btn" class="menu_button" style="margin:0; font-size:11px; padding:4px 8px; background:rgba(220,53,69,0.2) !important; color:#ff8888 !important; white-space:nowrap;" title="结束向导并保存当前已建立的分组"><i class="fa-solid fa-circle-stop"></i> 结束向导</button>
                                </div>
                                <button id="wizard-pass-all-btn" class="menu_button" style="margin:0; font-size:11px; padding:4px 8px; background:rgba(0,123,255,0.2) !important; color:#4dabf7 !important; white-space:nowrap;" title="将其余候选全自动通过"><i class="fa-solid fa-forward-fast"></i> 全部剩余通过</button>
                            </div>
                        </div>
                    `;

                    let actionTaken = 'standard';
                    let currentTagName = candidate.keyword;
                    let currentCheckedThemes = [...initialThemes];

                    const popupRes = await ctx.callGenericPopup(wizardHtml, 'confirm', null, {
                        title: `美化分组审核 (${currentIndex + 1}/${candidates.length})`,
                        okButton: '✔ 通过并创建/合并',
                        cancelButton: '✖ 不通过 / 跳过',
                        wide: true,
                        onOpen: (popup) => {
                            const dlg = popup.dlg;
                            if (dlg) {
                                dlg.style.width = '80vw';
                                dlg.style.height = '80vh';
                                dlg.style.maxWidth = '900px';
                                dlg.style.maxHeight = '80vh';
                                dlg.style.display = 'flex';
                                dlg.style.flexDirection = 'column';
                            }

                            const updateWizardState = () => {
                                if (!dlg) return;
                                const inp = dlg.querySelector('#wizard-tag-name-input');
                                if (inp) {
                                    const val = inp.value.trim();
                                    if (val) currentTagName = val;
                                }
                                const chks = dlg.querySelectorAll('.wizard-theme-chk:checked');
                                if (chks.length > 0) {
                                    currentCheckedThemes = Array.from(chks).map(cb => cb.value);
                                }
                            };

                            const nameInput = dlg ? dlg.querySelector('#wizard-tag-name-input') : null;
                            if (nameInput) {
                                nameInput.addEventListener('input', updateWizardState);
                                nameInput.addEventListener('change', updateWizardState);
                                nameInput.addEventListener('blur', updateWizardState);
                            }

                            const themesContainer = dlg ? dlg.querySelector('#wizard-themes-container') : null;
                            if (themesContainer) {
                                themesContainer.addEventListener('change', updateWizardState);
                            }

                            const okBtn = dlg ? dlg.querySelector('.popup-button-ok') : null;
                            if (okBtn) {
                                okBtn.addEventListener('click', updateWizardState);
                            }

                            const loadMoreBtn = dlg ? dlg.querySelector('#wizard-load-more-btn') : null;
                            if (loadMoreBtn) {
                                loadMoreBtn.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    const container = dlg.querySelector('#wizard-themes-container');
                                    loadMoreBtn.remove();
                                    const frag = document.createDocumentFragment();
                                    remainingThemes.forEach(tName => {
                                        const lbl = document.createElement('label');
                                        lbl.style.cssText = 'display:flex; flex-direction:row; align-items:center; gap:8px; font-size:12px; cursor:pointer; padding:4px 8px; background:rgba(255,255,255,0.02); border-radius:3px; user-select:none; white-space:nowrap; writing-mode:horizontal-tb !important;';
                                        lbl.innerHTML = `<input type="checkbox" class="wizard-theme-chk" value="${escapeHtml(tName)}" checked style="margin:0;"><span style="word-break:break-all; writing-mode:horizontal-tb !important;">${escapeHtml(tName)}</span>`;
                                        frag.appendChild(lbl);
                                    });
                                    container.appendChild(frag);
                                    updateWizardState();
                                });
                            }

                            const undoBtn = dlg ? dlg.querySelector('#wizard-undo-btn') : null;
                            if (undoBtn) {
                                undoBtn.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    actionTaken = 'undo';
                                    popup.close();
                                });
                            }

                            const stopBtn = dlg ? dlg.querySelector('#wizard-stop-btn') : null;
                            if (stopBtn) {
                                stopBtn.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    actionTaken = 'stop';
                                    popup.close();
                                });
                            }

                            const passAllBtn = dlg ? dlg.querySelector('#wizard-pass-all-btn') : null;
                            if (passAllBtn) {
                                passAllBtn.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    actionTaken = 'pass_all';
                                    popup.close();
                                });
                            }
                        }
                    });

                    // 辅助函数：保存/更新/合并二级与一级标签但不重刷全量 DOM
                    const createTagAndSaveSilent = (cItem, tagName, themesList) => {
                        if (!themesList || themesList.length === 0) return { success: false, isNew: false };
                        let tags = loadThemeTags();

                        let isNew = false;
                        // 支持同级标签合并：匹配同级别且同名的已有标签
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

                        // 若为二级子标签，同步把美化追加至其归属的一级主分类 themes 中
                        if (parentId) {
                            let currPId = parentId;
                            const visited = new Set();
                            while (currPId && !visited.has(currPId)) {
                                visited.add(currPId);
                                const parentTagObj = tags.find(t => t.id === currPId);
                                if (parentTagObj) {
                                    if (!parentTagObj.themes) parentTagObj.themes = [];
                                    themesList.forEach(tn => {
                                        if (!parentTagObj.themes.includes(tn)) parentTagObj.themes.push(tn);
                                    });
                                    currPId = parentTagObj.parentId;
                                } else {
                                    break;
                                }
                            }
                        }

                        saveThemeTags(tags);
                        return { success: true, isNew: isNew, tagId: tagObj.id };
                    };

                    // 1. 中途撤销上一步 (Rollback History)
                    if (actionTaken === 'undo') {
                        if (historyStack.length > 0) {
                            const lastStep = historyStack.pop();
                            if (lastStep.action === 'approve' && lastStep.addedThemes && lastStep.addedThemes.length > 0) {
                                let tags = loadThemeTags();
                                const tagObj = tags.find(t => t.name.toLowerCase() === lastStep.tagName.toLowerCase() && (parentId ? t.parentId === parentId : true));
                                if (tagObj && tagObj.themes) {
                                    const removeSet = new Set(lastStep.addedThemes);
                                    tagObj.themes = tagObj.themes.filter(tn => !removeSet.has(tn));
                                    if (tagObj.themes.length === 0 && lastStep.isNew) {
                                        const idx = tags.indexOf(tagObj);
                                        if (idx > -1) tags.splice(idx, 1);
                                    }
                                    saveThemeTags(tags);
                                }
                            }
                            const newCreatedCount = Math.max(0, createdTagsCount - (lastStep.action === 'approve' ? 1 : 0));
                            setTimeout(() => runAutoGroupReviewStep(candidates, lastStep.currentIndex, level, parentId, newCreatedCount, assignedThemesCount, historyStack), 50);
                        } else {
                            setTimeout(() => runAutoGroupReviewStep(candidates, currentIndex, level, parentId, createdTagsCount, assignedThemesCount, historyStack), 50);
                        }
                        return;
                    }

                    // 2. 中途停止向导
                    if (actionTaken === 'stop') {
                        renderTagsUI();
                        updateActiveState();
                        toastr.info(`⏹️ 分组向导已停止。已为您生成并保存了 ${createdTagsCount} 个标签分类。`);
                        return;
                    }

                    // 3. 全部剩余自动通过
                    if (actionTaken === 'pass_all') {
                        let passCount = 0;
                        for (let i = currentIndex; i < candidates.length; i++) {
                            const c = candidates[i];
                            const res = createTagAndSaveSilent(c, c.keyword, c.themes);
                            if (res.success) passCount++;
                        }
                        renderTagsUI();
                        updateActiveState();
                        toastr.success(`🎉 分组向导完成！共自动生成并挂载了 ${createdTagsCount + passCount} 个标签分类。`);
                        return;
                    }

                    // 4. 标准用户按键分支 (通过 vs 跳过)
                    if (popupRes) {
                        // 用户点击了 '✅ 通过并创建/合并标签'
                        const tagName = currentTagName.trim() || candidate.keyword;
                        const finalThemes = (currentCheckedThemes && currentCheckedThemes.length > 0) ? currentCheckedThemes : candidate.themes;

                        const saveRes = createTagAndSaveSilent(candidate, tagName, finalThemes);

                        historyStack.push({
                            currentIndex: currentIndex,
                            action: 'approve',
                            tagName: tagName,
                            addedThemes: finalThemes,
                            isNew: saveRes.isNew
                        });

                        setTimeout(() => runAutoGroupReviewStep(candidates, currentIndex + 1, level, parentId, createdTagsCount + (saveRes.success ? 1 : 0), assignedThemesCount + finalThemes.length, historyStack), 50);
                    } else {
                        // 用户点击了 '❌ 不通过 / 跳过'
                        historyStack.push({
                            currentIndex: currentIndex,
                            action: 'skip',
                            tagName: candidate.keyword,
                            addedThemes: [],
                            isNew: false
                        });

                        setTimeout(() => runAutoGroupReviewStep(candidates, currentIndex + 1, level, parentId, createdTagsCount, assignedThemesCount, historyStack), 50);
                    }
                }

                // 高级关键词映射管理弹窗：可直观查看关键词胶囊、一键删除独立关键词、无损追加新关键词
                async 