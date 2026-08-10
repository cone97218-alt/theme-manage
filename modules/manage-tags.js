/**
 * manage-tags.js
 * 标签管理弹窗与分类树界面
 */

import { state } from './state.js';
import { THEME_TAGS_KEY, ENABLE_SUBTAGS_KEY } from './constants.js';
import { escapeHtml } from './utils.js';
import { loadThemeTags, saveThemeTags, invalidateTagsCache } from './tags-core.js';
import { renderTagsUI } from './tags-ui.js';
import { softRefreshUI } from './tags-ui.js';
import { confirmAction, promptAction } from './api.js';

export function openManageTagsPopup() {
    let currentTags = loadThemeTags();

    function renderTagTree(tags, parentTagId = null, depth = 0) {
        let html = '';
        const children = tags.filter(t => (parentTagId ? t.parentId === parentTagId : (!t.parentId || !tags.some(p => p.id === t.parentId))));

        children.forEach(tag => {
            const indent = depth * 20;
            const themeCount = tag.themes ? tag.themes.length : 0;
            const hasSubtags = tags.some(t => t.parentId === tag.id);

            html += `
                <div class="tm-tag-manage-item level-${depth + 1}" data-tag-id="${tag.id}" style="margin-left: ${indent}px;">
                    <div class="tm-tag-manage-name">
                        <span class="tm-tag-drag-handle"><i class="fa-solid fa-grip-lines"></i></span>
                        <span class="tm-tag-icon"><i class="fa-solid ${depth === 0 ? 'fa-folder' : 'fa-tag'}"></i></span>
                        <span class="tm-tag-title">${escapeHtml(tag.name)}</span>
                        <span class="tm-tag-count">(${themeCount} 个美化)</span>
                    </div>
                    <div class="tm-tag-manage-actions">
                        <button class="tm-tag-add-sub-btn menu_button" data-tag-id="${tag.id}" title="添加子分类"><i class="fa-solid fa-plus"></i></button>
                        <button class="tm-tag-edit-btn menu_button" data-tag-id="${tag.id}" title="修改名称"><i class="fa-solid fa-pen"></i></button>
                        <button class="tm-tag-delete-btn menu_button" data-tag-id="${tag.id}" title="删除标签"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </div>`;
            if (hasSubtags) {
                html += renderTagTree(tags, tag.id, depth + 1);
            }
        });
        return html;
    }

    const modalContent = `
        <div class="tm-manage-tags-container">
            <div class="tm-manage-tags-header">
                <button id="tm-add-root-tag-btn" class="menu_button primary"><i class="fa-solid fa-plus"></i> 新建主分类</button>
            </div>
            <div id="tm-tags-tree-list" class="tm-tags-tree-list">
                ${renderTagTree(currentTags)}
            </div>
        </div>`;

    if (typeof ctx !== 'undefined' && ctx.callGenericPopup) {
        ctx.callGenericPopup(modalContent, 'confirm', null, {
            title: '标签与分类管理',
            okButton: '完成',
            cancelButton: null,
            wide: true,
            onOpen: (popup) => {
                const dlg = popup.dlg;
                const treeList = dlg.querySelector('#tm-tags-tree-list');

                const refreshList = () => {
                    currentTags = loadThemeTags();
                    if (treeList) treeList.innerHTML = renderTagTree(currentTags);
                    bindEvents();
                };

                const bindEvents = () => {
                    dlg.querySelectorAll('.tm-tag-add-sub-btn').forEach(btn => {
                        btn.onclick = async () => {
                            const parentId = btn.dataset.tagId;
                            const subName = await promptAction('请输入新的子标签名称：');
                            if (subName && subName.trim()) {
                                const newTag = {
                                    id: 'tag_' + Date.now(),
                                    name: subName.trim(),
                                    parentId: parentId,
                                    themes: [],
                                    keywords: []
                                };
                                currentTags.push(newTag);
                                saveThemeTags(currentTags);
                                refreshList();
                                softRefreshUI([]);
                            }
                        };
                    });

                    dlg.querySelectorAll('.tm-tag-edit-btn').forEach(btn => {
                        btn.onclick = async () => {
                            const tagId = btn.dataset.tagId;
                            const tag = currentTags.find(t => t.id === tagId);
                            if (tag) {
                                const newName = await promptAction('请输入新的标签名称：', tag.name);
                                if (newName && newName.trim() && newName.trim() !== tag.name) {
                                    tag.name = newName.trim();
                                    saveThemeTags(currentTags);
                                    refreshList();
                                    softRefreshUI([]);
                                }
                            }
                        };
                    });

                    dlg.querySelectorAll('.tm-tag-delete-btn').forEach(btn => {
                        btn.onclick = async () => {
                            const tagId = btn.dataset.tagId;
                            const tag = currentTags.find(t => t.id === tagId);
                            if (tag) {
                                const confirmed = await confirmAction(`确定要删除标签「${tag.name}」吗？`);
                                if (confirmed) {
                                    currentTags = currentTags.filter(t => t.id !== tagId && t.parentId !== tagId);
                                    saveThemeTags(currentTags);
                                    refreshList();
                                    softRefreshUI();
                                }
                            }
                        };
                    });
                };

                const addRootBtn = dlg.querySelector('#tm-add-root-tag-btn');
                if (addRootBtn) {
                    addRootBtn.onclick = async () => {
                        const rootName = await promptAction('请输入新的主分类名称：');
                        if (rootName && rootName.trim()) {
                            const newTag = {
                                id: 'tag_' + Date.now(),
                                name: rootName.trim(),
                                parentId: null,
                                themes: [],
                                keywords: []
                            };
                            currentTags.push(newTag);
                            saveThemeTags(currentTags);
                            refreshList();
                            softRefreshUI([]);
                        }
                    };
                }

                bindEvents();
            }
        });
    }
}
