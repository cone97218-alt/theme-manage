/**
 * auto-group.js
 * 智能美化分组向导、候选算法提取与全景审核矩阵
 */

import { state, ctx } from './state.js';
import { escapeHtml } from './utils.js';
import { loadThemeTags, saveThemeTags } from './tags-core.js';
import { renderTagsUI } from './tags-ui.js';
import { softRefreshUI } from './theme-ui.js';


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
                toastr.success(`成功分析出 ${candidates.length} 个候选分组！`);
            } else {
                toastr.info('未分析出符合门槛的分组。');
            }
        }
    }
}
