/**
 * modules/theme-import.js
 * 美化主题批量导入与压缩包导入、目标标签分配交互模块
 */

let jszipPromise = null;

/**
 * 动态异步加载 JSZip 库 (优先尝试原生全局、动态 import，最后降级为动态 script 标签加载)
 */
export async function getJSZip() {
    if (typeof window !== 'undefined' && window.JSZip) {
        return window.JSZip;
    }
    if (jszipPromise) return jszipPromise;

    jszipPromise = (async () => {
        if (typeof window !== 'undefined' && window.JSZip) {
            return window.JSZip;
        }

        // 1. 尝试从酒馆根路径动态 import /lib/jszip.min.js
        try {
            const mod = await import('/lib/jszip.min.js');
            if (typeof window !== 'undefined' && window.JSZip) return window.JSZip;
            if (mod && mod.default) return mod.default;
        } catch (_) {}

        // 2. 尝试相对路径 import
        try {
            const mod = await import('../../../lib/jszip.min.js');
            if (typeof window !== 'undefined' && window.JSZip) return window.JSZip;
            if (mod && mod.default) return mod.default;
        } catch (_) {}

        // 3. 浏览器环境下降级：注入 <script> 标签加载
        if (typeof document !== 'undefined' && document.head) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = '/lib/jszip.min.js';
                script.onload = () => resolve();
                script.onerror = () => {
                    const fallbackScript = document.createElement('script');
                    fallbackScript.src = 'lib/jszip.min.js';
                    fallbackScript.onload = () => resolve();
                    fallbackScript.onerror = (err) => reject(new Error('未能加载 lib/jszip.min.js 压缩包解析库'));
                    document.head.appendChild(fallbackScript);
                };
                document.head.appendChild(script);
            });
            if (typeof window !== 'undefined' && window.JSZip) return window.JSZip;
        }

        throw new Error('未检测到 JSZip 库，请确认酒馆 public/lib/jszip.min.js 文件是否存在。');
    })();

    return jszipPromise;
}

/**
 * 检查文件是否为 ZIP 压缩包
 */
export function isZipFile(file) {
    if (!file || !file.name) return false;
    const name = file.name.toLowerCase();
    return name.endsWith('.zip') ||
        (file.type && (
            file.type === 'application/zip' ||
            file.type === 'application/x-zip-compressed' ||
            file.type === 'application/x-zip'
        ));
}

export function initThemeImport(config) {
    const {
        loadThemeTags,
        saveThemeTags,
        isSubtagsEnabled,
        getActiveTagFilters = () => new Set(),
        escapeHtml,
        callGenericPopup,
        toastr,
        fileInput,
        showLoader,
        hideLoader,
        limitConcurrency,
        saveTheme,
        suspendObserver = (fn) => fn(),
        setSuspendObserver = () => {},
        updateSTThemeMemory,
        findOptionByValue,
        originalSelect,
        stKnownThemes,
        syncStKnownThemes,
        allThemeObjectsMap,
        allThemeObjects,
        invalidateThemesCache,
        invalidateValidThemeNamesCache,
        allParsedThemesMap,
        softAddThemeUI,
        contentWrapper,
        applyKeywordMappings,
        softRefreshUI,
        filterThemeList,
        updateActiveState,
        normalizeThemeObject = (t) => t,
        openCustomImportModal = () => {}
    } = config;

    // 弹窗让用户设置导入美化时所分配的目标分类标签
    async function showImportTagSelectionPopup(validFiles, invalidFiles) {
        const tags = loadThemeTags();
        const subtagsEnabled = isSubtagsEnabled();
        const activeTagFilters = getActiveTagFilters();

        // 识别来源压缩包与文件夹结构
        const sourceZips = [...new Set(validFiles.map(f => f.sourceZip).filter(Boolean))];
        const detectedFolders = [...new Set(validFiles.map(f => f.zipFolderName).filter(Boolean))];
        const isFromZip = sourceZips.length > 0;
        const singleZipCleanName = (sourceZips.length === 1) ? sourceZips[0].replace(/\.zip$/i, '').trim() : null;

        // 检查当前是否有正在筛选的单标签
        const currentActiveTagId = (activeTagFilters && activeTagFilters.size === 1)
            ? Array.from(activeTagFilters)[0]
            : null;

        // 构建下拉框选项
        let optionsHtml = `<option value="">-- 不分配标签 (默认) --</option>`;
        optionsHtml += `<option value="__new__">➕ 创建新标签并导入...</option>`;

        if (!subtagsEnabled) {
            tags.forEach(t => {
                const isSelected = (currentActiveTagId && t.id === currentActiveTagId);
                optionsHtml += `<option value="${escapeHtml(t.id)}" ${isSelected ? 'selected' : ''}>🏷️ ${escapeHtml(t.name)}${isSelected ? ' (当前筛选)' : ''}</option>`;
            });
        } else {
            const rootTags = tags.filter(t => !t.parentId || !tags.some(p => p.id === t.parentId));
            const renderOptionTree = (nodeTag, depth) => {
                const isSelected = (currentActiveTagId && nodeTag.id === currentActiveTagId);
                const indent = '&nbsp;&nbsp;&nbsp;&nbsp;'.repeat(depth);
                const icon = depth === 0 ? '📁 ' : '↳ 🏷️ ';
                let h = `<option value="${escapeHtml(nodeTag.id)}" ${isSelected ? 'selected' : ''}>${indent}${icon}${escapeHtml(nodeTag.name)}${isSelected ? ' (当前筛选)' : ''}</option>`;
                const children = tags.filter(t => t.parentId === nodeTag.id);
                children.forEach(c => {
                    h += renderOptionTree(c, depth + 1);
                });
                return h;
            };
            rootTags.forEach(rTag => {
                optionsHtml += renderOptionTree(rTag, 0);
            });
        }

        let parentOptionsHtml = `<option value="">📁 作为根标签 (一级目录)</option>`;
        if (subtagsEnabled && tags.length > 0) {
            const rootTags = tags.filter(t => !t.parentId || !tags.some(p => p.id === t.parentId));
            const renderParentOptionTree = (nodeTag, depth) => {
                const indent = '&nbsp;&nbsp;&nbsp;&nbsp;'.repeat(depth);
                const icon = depth === 0 ? '📁 ' : '↳ 🏷️ ';
                let h = `<option value="${escapeHtml(nodeTag.id)}">${indent}${icon}放入「${escapeHtml(nodeTag.name)}」下 (${depth + 2}级标签)</option>`;
                const children = tags.filter(t => t.parentId === nodeTag.id);
                children.forEach(c => {
                    h += renderParentOptionTree(c, depth + 1);
                });
                return h;
            };
            rootTags.forEach(rTag => {
                parentOptionsHtml += renderParentOptionTree(rTag, 0);
            });
        }

        // 构建多选标签树 HTML（供切换多选时使用）
        let multitagHtml = '';
        if (tags.length > 0) {
            if (!subtagsEnabled) {
                tags.forEach(t => {
                    const isChecked = (currentActiveTagId && t.id === currentActiveTagId);
                    multitagHtml += `
                        <label style="display:flex; align-items:center; gap:6px; padding:3px 4px; font-size:12px; cursor:pointer;">
                            <input type="checkbox" class="tm-imp-multitag-cb" value="${escapeHtml(t.id)}" ${isChecked ? 'checked' : ''}>
                            <span>🏷️ ${escapeHtml(t.name)}</span>
                        </label>
                    `;
                });
            } else {
                const rootTags = tags.filter(t => !t.parentId || !tags.some(p => p.id === t.parentId));
                const renderTreeMulti = (nodeTag, depth) => {
                    const isChecked = (currentActiveTagId && nodeTag.id === currentActiveTagId);
                    let h = `
                        <div style="margin-left:${depth > 0 ? 12 : 0}px; margin-bottom:3px;">
                            <label style="display:flex; align-items:center; gap:6px; font-size:${depth === 0 ? '12px' : '11px'}; font-weight:${depth === 0 ? 'bold' : 'normal'}; cursor:pointer;">
                                <input type="checkbox" class="tm-imp-multitag-cb" value="${escapeHtml(nodeTag.id)}" ${isChecked ? 'checked' : ''}>
                                <i class="${depth === 0 ? 'fa-solid fa-folder-open' : 'fa-solid fa-tag'}" style="${depth === 0 ? 'color:var(--SmartThemeQuoteColor, #4a90e2);' : 'opacity:0.7;'} font-size:11px;"></i>
                                <span>${escapeHtml(nodeTag.name)}</span>
                            </label>
                    `;
                    const children = tags.filter(t => t.parentId === nodeTag.id);
                    if (children.length > 0) {
                        h += `<div style="display:flex; flex-direction:column; gap:3px; margin-left:14px; padding-left:4px; border-left:1px solid rgba(255,255,255,0.1);">`;
                        children.forEach(c => {
                            h += renderTreeMulti(c, depth + 1);
                        });
                        h += `</div>`;
                    }
                    h += `</div>`;
                    return h;
                };
                rootTags.forEach(r => {
                    multitagHtml += renderTreeMulti(r, 0);
                });
            }
        } else {
            multitagHtml = `<div style="font-size:11px; opacity:0.6; padding:4px;">暂无标签，可使用上方选项快速新建。</div>`;
        }

        const popupHtml = `
            <div class="tm-imp-dialog-content" style="text-align:left; font-size:13px; display:flex; flex-direction:column; gap:10px; max-height:calc(80vh - 130px); max-height:calc(80dvh - 130px); overflow-y:auto; padding-right:4px; flex:0 1 auto; min-height:0;">
                <!-- 文件信息卡片 -->
                <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:8px 10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <span style="font-weight:bold; font-size:13px; display:inline-flex; align-items:center; gap:6px;">
                            <i class="${isFromZip ? 'fa-solid fa-file-zipper' : 'fa-solid fa-file-arrow-up'}" style="color:${isFromZip ? '#e5a93c' : 'var(--SmartThemeQuoteColor, #4a90e2)'};"></i>
                            ${isFromZip ? '准备从压缩包导入美化主题' : '准备导入美化主题'}
                        </span>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span style="font-size:11.5px; opacity:0.8; background:rgba(255,255,255,0.08); padding:1px 6px; border-radius:4px;">
                                共 ${validFiles.length} 个
                            </span>
                            <button id="tm-imp-reselect-btn" class="menu_button" type="button" style="width:26px; height:26px; min-width:26px; padding:0; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; cursor:pointer; font-size:12px; border-radius:4px;" title="重新选择美化文件或压缩包"><i class="fa-solid fa-arrows-rotate"></i></button>
                        </div>
                    </div>

                    ${isFromZip ? `
                        <div style="font-size:11.5px; opacity:0.85; margin-bottom:6px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <span style="display:inline-flex; align-items:center; gap:5px; background:rgba(229,169,60,0.12); border:1px solid rgba(229,169,60,0.28); color:#e5a93c; padding:2px 8px; border-radius:4px; font-weight:500;">
                                <i class="fa-solid fa-file-zipper"></i> 压缩包来源: <b>${escapeHtml(sourceZips.join(', '))}</b>
                            </span>
                        </div>
                    ` : ''}

                    <div style="max-height:75px; overflow-y:auto; display:flex; flex-wrap:wrap; gap:4px; padding:2px;">
                        ${validFiles.slice(0, 60).map(f => `
                            <span style="display:inline-flex; align-items:center; gap:4px; padding:2px 6px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.05); border-radius:4px; font-size:11px; font-family:monospace;" title="${f.sourceZip ? `来源压缩包: ${escapeHtml(f.sourceZip)}${f.zipFolderName ? ` / 目录: ${escapeHtml(f.zipFolderName)}` : ''}` : ''}">
                                <i class="fa-solid ${f.sourceZip ? 'fa-file-zipper' : 'fa-palette'}" style="font-size:10px; opacity:0.7; ${f.sourceZip ? 'color:#e5a93c;' : ''}"></i>
                                ${escapeHtml(f.themeObject.name)}
                                ${f.zipFolderName ? `<span style="opacity:0.6; font-size:9.5px; margin-left:2px;">[${escapeHtml(f.zipFolderName)}]</span>` : ''}
                            </span>
                        `).join('')}
                        ${validFiles.length > 60 ? `
                            <span style="display:inline-flex; align-items:center; padding:2px 6px; background:rgba(255,255,255,0.03); border:1px dashed rgba(255,255,255,0.1); border-radius:4px; font-size:11px; opacity:0.75;">
                                + 剩余 ${validFiles.length - 60} 个美化主题...
                            </span>
                        ` : ''}
                    </div>
                    ${invalidFiles.length > 0 ? `
                        <div style="color:#ffaa00; font-size:11px; margin-top:6px; display:flex; align-items:center; gap:4px;">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                            另有 ${invalidFiles.length} 个非有效主题/无法解析项将被自动跳过
                        </div>
                    ` : ''}
                </div>

                <!-- 目标标签卡片 -->
                <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <label style="font-weight:bold; font-size:13px; margin:0; display:flex; align-items:center; gap:6px;">
                            <i class="fa-solid fa-tags" style="color:var(--SmartThemeQuoteColor, #4a90e2);"></i>
                            导入目标分类标签：
                        </label>
                        ${tags.length > 0 ? `
                            <button id="tm-imp-multitag-toggle" class="menu_button" type="button" style="width:26px; height:26px; min-width:26px; padding:0; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; cursor:pointer; font-size:12px; border-radius:4px;" title="切换多选标签模式">
                                <i class="fa-solid fa-list-check"></i>
                            </button>
                        ` : ''}
                    </div>

                    <!-- 单选下拉模式 -->
                    <div id="tm-imp-singletag-wrap">
                        <select id="tm-imp-tag-select" class="text_pole" style="width:100%; height:32px; font-size:12.5px; padding:2px 8px; margin:0; box-sizing:border-box;">
                            ${optionsHtml}
                        </select>

                        ${singleZipCleanName ? `
                            <div style="margin-top:8px; width:100%;">
                                <button id="tm-imp-use-zipname-btn" class="menu_button" type="button" style="width:100% !important; max-width:100% !important; box-sizing:border-box !important; display:flex !important; flex-direction:row !important; align-items:center !important; justify-content:space-between !important; writing-mode:horizontal-tb !important; text-orientation:mixed !important; white-space:normal !important; word-break:break-word !important; padding:6px 10px !important; font-size:12px !important; line-height:1.4 !important; min-height:32px !important; height:auto !important; aspect-ratio:auto !important; cursor:pointer !important; background:rgba(229,169,60,0.12) !important; border:1px solid rgba(229,169,60,0.35) !important; border-radius:6px !important; color:var(--SmartThemeBodyColor, #ffffff) !important; text-align:left !important; gap:8px !important;" title="以压缩包名称「${escapeHtml(singleZipCleanName)}」创建新标签并导入">
                                    <div style="display:flex !important; flex-direction:row !important; align-items:center !important; gap:8px !important; min-width:0 !important; flex:1 !important; writing-mode:horizontal-tb !important;">
                                        <i class="fa-solid fa-file-zipper" style="color:#e5a93c !important; font-size:13px !important; flex-shrink:0 !important;"></i>
                                        <span style="font-size:12px !important; writing-mode:horizontal-tb !important; white-space:normal !important; word-break:break-all !important; line-height:1.4 !important; text-align:left !important;">
                                            以此压缩包名新建标签：<b style="color:#e5a93c !important;">${escapeHtml(singleZipCleanName)}</b>
                                        </span>
                                    </div>
                                    <span style="font-size:11px !important; opacity:0.8 !important; flex-shrink:0 !important; background:rgba(255,255,255,0.1) !important; padding:2px 7px !important; border-radius:4px !important; white-space:nowrap !important; writing-mode:horizontal-tb !important;">
                                        一键填入
                                    </span>
                                </button>
                            </div>
                        ` : ''}

                        <!-- 新建标签输入栏与层级选择 -->
                        <div id="tm-imp-new-tag-wrap" style="display:none; margin-top:8px; padding:8px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.08); border-radius:6px;">
                            <div style="font-size:11.5px; opacity:0.8; margin-bottom:4px; font-weight:bold;">
                                <i class="fa-solid fa-plus" style="margin-right:4px;"></i>新建标签设置：
                            </div>
                            <input type="text" id="tm-imp-new-tag-input" class="text_pole" placeholder="请输入要新建的标签名称..." style="width:100%; height:30px; font-size:12px; padding:2px 8px; box-sizing:border-box; margin-bottom:6px;">
                            ${subtagsEnabled ? `
                                <div style="display:flex; flex-direction:column; gap:4px;">
                                    <label style="font-size:11px; opacity:0.75; display:flex; align-items:center; gap:4px;">
                                        <i class="fa-solid fa-sitemap" style="font-size:10px;"></i> 标签所属层级 / 父级目录：
                                    </label>
                                    <select id="tm-imp-new-tag-parent-select" class="text_pole" style="width:100%; height:28px; font-size:11.5px; padding:1px 6px; margin:0; box-sizing:border-box;">
                                        ${parentOptionsHtml}
                                    </select>
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <!-- 多选模式 (默认隐藏) -->
                    <div id="tm-imp-multitag-wrap" style="display:none; margin-top:6px;">
                        <div style="font-size:11px; opacity:0.7; margin-bottom:4px;">勾选要分配的标签（可多选）：</div>
                        <div style="max-height:140px; overflow-y:auto; padding:6px; border:1px solid rgba(255,255,255,0.08); border-radius:6px; background:rgba(0,0,0,0.15); display:flex; flex-direction:column; gap:2px;">
                            ${multitagHtml}
                        </div>
                    </div>

                    <div style="margin-top:6px; font-size:11px; opacity:0.65; line-height:1.4;">
                        💡 提示：设置后，本次导入的美化将自动加入对应标签，方便在标签栏中按类快速筛选与管理。
                    </div>
                </div>

                <!-- 压缩包内文件夹自动建标签选项 (当检测到子目录时展示) -->
                ${detectedFolders.length > 0 ? `
                    <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:8px 10px;">
                        <label style="display:flex; align-items:flex-start; gap:8px; font-size:12px; cursor:pointer; user-select:none; margin:0;">
                            <input type="checkbox" id="tm-imp-zip-folder-tags" checked style="margin-top:2px; flex-shrink:0;">
                            <div style="flex:1;">
                                <span style="font-weight:bold; color:var(--SmartThemeQuoteColor, #4a90e2); display:flex; align-items:center; gap:5px;">
                                    <i class="fa-solid fa-folder-tree"></i> 根据压缩包内文件夹自动分类到对应标签
                                </span>
                                <div style="font-size:11px; opacity:0.75; margin-top:2px; line-height:1.4;">
                                    检测到文件夹目录: <b>${escapeHtml(detectedFolders.slice(0, 5).join('、'))}${detectedFolders.length > 5 ? ` 等共 ${detectedFolders.length} 个` : ''}</b>。勾选后各美化将按所在文件夹自动分门别类创建并归入对应标签。
                                </div>
                            </div>
                        </label>
                    </div>
                ` : ''}

                <!-- 规则选项 -->
                <div style="padding:0 2px;">
                    <label style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer; user-select:none;">
                        <input type="checkbox" id="tm-imp-apply-kw" checked>
                        <span>同时对导入的美化执行关键词规则自动映射标签</span>
                    </label>
                </div>
            </div>
        `;

        return new Promise(async (resolve) => {
            let isResolved = false;
            let isMultiMode = false;

            await callGenericPopup(popupHtml, 'confirm', null, {
                title: isFromZip ? `压缩包主题导入 (${validFiles.length} 个美化)` : `导入主题设置 (${validFiles.length} 个美化)`,
                okButton: '确认导入',
                cancelButton: '取消',
                wide: false,
                onOpen: (popup) => {
                    const dlg = popup.dlg;
                    if (!dlg) return;

                    dlg.classList.add('tm-tag-assign-dialog');
                    dlg.style.maxHeight = '80vh';
                    dlg.style.maxHeight = '80dvh';
                    dlg.style.height = 'auto';
                    dlg.style.display = 'flex';
                    dlg.style.flexDirection = 'column';
                    dlg.style.width = '92vw';
                    dlg.style.maxWidth = '500px';

                    const body = dlg.querySelector('.popup-body');
                    if (body) {
                        body.style.maxHeight = 'calc(80vh - 16px)';
                        body.style.maxHeight = 'calc(80dvh - 16px)';
                        body.style.height = 'auto';
                        body.style.minHeight = '0';
                        body.style.flex = '0 1 auto';
                        body.style.display = 'flex';
                        body.style.flexDirection = 'column';
                        body.style.overflow = 'hidden';
                    }

                    const content = dlg.querySelector('.popup-content');
                    if (content) {
                        content.style.maxHeight = 'calc(80vh - 80px)';
                        content.style.maxHeight = 'calc(80dvh - 80px)';
                        content.style.height = 'auto';
                        content.style.minHeight = '0';
                        content.style.flex = '0 1 auto';
                        content.style.display = 'flex';
                        content.style.flexDirection = 'column';
                        content.style.overflow = 'hidden';
                        content.style.padding = '0 4px';
                        content.style.marginTop = '6px';
                    }

                    const tagSelect = dlg.querySelector('#tm-imp-tag-select');
                    const newTagWrap = dlg.querySelector('#tm-imp-new-tag-wrap');
                    const newTagInput = dlg.querySelector('#tm-imp-new-tag-input');
                    const singleWrap = dlg.querySelector('#tm-imp-singletag-wrap');
                    const multiWrap = dlg.querySelector('#tm-imp-multitag-wrap');
                    const multiToggleBtn = dlg.querySelector('#tm-imp-multitag-toggle');
                    const reselectBtn = dlg.querySelector('#tm-imp-reselect-btn');
                    const useZipNameBtn = dlg.querySelector('#tm-imp-use-zipname-btn');
                    const zipFolderCb = dlg.querySelector('#tm-imp-zip-folder-tags');
                    const applyKwCb = dlg.querySelector('#tm-imp-apply-kw');
                    const okBtn = dlg.querySelector('.popup-button-ok');

                    // 下拉选择切换
                    if (tagSelect) {
                        tagSelect.addEventListener('change', () => {
                            if (tagSelect.value === '__new__') {
                                newTagWrap.style.display = 'block';
                                if (newTagInput) {
                                    newTagInput.focus();
                                }
                            } else {
                                newTagWrap.style.display = 'none';
                            }
                        });
                    }

                    // 快速以压缩包名新建标签按钮
                    if (useZipNameBtn && singleZipCleanName) {
                        useZipNameBtn.addEventListener('click', () => {
                            if (isMultiMode && multiToggleBtn) {
                                multiToggleBtn.click();
                            }
                            if (tagSelect) {
                                tagSelect.value = '__new__';
                                tagSelect.dispatchEvent(new Event('change'));
                            }
                            if (newTagInput) {
                                newTagInput.value = singleZipCleanName;
                                newTagInput.focus();
                            }
                        });
                    }

                    // 多选切换按钮
                    if (multiToggleBtn) {
                        multiToggleBtn.addEventListener('click', () => {
                            isMultiMode = !isMultiMode;
                            if (isMultiMode) {
                                singleWrap.style.display = 'none';
                                multiWrap.style.display = 'block';
                                multiToggleBtn.innerHTML = '<i class="fa-solid fa-list"></i>';
                                multiToggleBtn.title = '切换回单选下拉';
                            } else {
                                singleWrap.style.display = 'block';
                                multiWrap.style.display = 'none';
                                multiToggleBtn.innerHTML = '<i class="fa-solid fa-list-check"></i>';
                                multiToggleBtn.title = '切换为多选标签模式';
                            }
                        });
                    }

                    // 重选文件按钮
                    if (reselectBtn) {
                        reselectBtn.addEventListener('click', () => {
                            isResolved = true;
                            resolve(null);
                            const cancelBtn = dlg.querySelector('.popup-button-cancel');
                            if (cancelBtn) cancelBtn.click();
                            setTimeout(() => { if (fileInput) fileInput.click(); }, 120);
                        });
                    }

                    // 确认拦截校验 (捕获阶段)
                    if (okBtn) {
                        okBtn.addEventListener('click', (e) => {
                            let targetTagIds = [];
                            let newTagName = null;
                            let newTagParentId = null;

                            if (isMultiMode) {
                                const checkedCbs = dlg.querySelectorAll('.tm-imp-multitag-cb:checked');
                                targetTagIds = Array.from(checkedCbs).map(cb => cb.value);
                            } else {
                                if (tagSelect.value === '__new__') {
                                    const val = newTagInput ? newTagInput.value.trim() : '';
                                    if (!val) {
                                        e.preventDefault();
                                        e.stopImmediatePropagation();
                                        toastr.warning('请输入新标签名称，或选择已有标签。');
                                        if (newTagInput) newTagInput.focus();
                                        return;
                                    }
                                    newTagName = val;
                                    const parentSel = dlg.querySelector('#tm-imp-new-tag-parent-select');
                                    newTagParentId = (parentSel && parentSel.value) ? parentSel.value : null;
                                } else if (tagSelect.value) {
                                    targetTagIds = [tagSelect.value];
                                }
                            }

                            isResolved = true;
                            resolve({
                                confirmed: true,
                                targetTagIds,
                                newTagName,
                                newTagParentId,
                                applyKeywords: applyKwCb ? applyKwCb.checked : true,
                                useZipFolderTags: zipFolderCb ? zipFolderCb.checked : false
                            });
                        }, true);
                    }
                }
            });

            if (!isResolved) {
                resolve(null);
            }
        });
    }

    async function handleBatchThemeImport(files) {
        if (!files || !files.length) return;

        showLoader();

        try {
            // 1. 读取文件内容并智能识别：单主题、主题合集数组、备份包文件、轻量配置或 ZIP 压缩包
            const rawFiles = Array.from(files);
            const fileEntries = [];
            const invalidFiles = [];
            let detectedBackup = null;

            // 预先解压所有压缩包文件并收集 JSON 实体
            for (const file of rawFiles) {
                if (isZipFile(file)) {
                    try {
                        const JSZip = await getJSZip();
                        const zipData = (typeof file.arrayBuffer === 'function') ? await file.arrayBuffer() : file;
                        const zip = await JSZip.loadAsync(zipData);
                        const zipEntriesToRead = [];

                        zip.forEach((relativePath, entry) => {
                            if (entry.dir) return;
                            // 排除 macOS 系统自动生成的冗余文件及隐藏文件
                            if (relativePath.includes('__MACOSX/') || relativePath.split('/').some(p => p.startsWith('.'))) {
                                return;
                            }
                            if (relativePath.toLowerCase().endsWith('.json')) {
                                zipEntriesToRead.push({ relativePath, entry });
                            }
                        });

                        if (zipEntriesToRead.length === 0) {
                            invalidFiles.push({
                                file,
                                valid: false,
                                error: '压缩包内未找到任何有效的主题文件（.json）'
                            });
                            continue;
                        }

                        for (const { relativePath, entry } of zipEntriesToRead) {
                            try {
                                const text = await entry.async('string');
                                const pathParts = relativePath.split('/').filter(p => p && p.trim());
                                const filename = pathParts.pop() || entry.name;
                                const immediateFolder = pathParts.length > 0 ? pathParts[pathParts.length - 1] : null;
                                const folderPath = pathParts.join('/');

                                fileEntries.push({
                                    file: { name: filename, size: text.length },
                                    text,
                                    sourceZip: file.name,
                                    zipFolderName: immediateFolder,
                                    zipFolderPath: folderPath,
                                    error: null
                                });
                            } catch (entryErr) {
                                invalidFiles.push({
                                    file: { name: `${file.name}/${relativePath}` },
                                    valid: false,
                                    error: `解压文件失败: ${entryErr.message}`
                                });
                            }
                        }
                    } catch (zipErr) {
                        console.error('[Theme Manager] 读取解压 ZIP 失败:', zipErr);
                        invalidFiles.push({
                            file,
                            valid: false,
                            error: `解压压缩包失败: ${zipErr.message}`
                        });
                    }
                } else {
                    try {
                        const text = await file.text();
                        fileEntries.push({
                            file,
                            text,
                            sourceZip: null,
                            zipFolderName: null,
                            zipFolderPath: null,
                            error: null
                        });
                    } catch (err) {
                        invalidFiles.push({ file, valid: false, error: err.message });
                    }
                }
            }

            const parsedFiles = [];

            for (const { file, text: fileContent, sourceZip, zipFolderName, zipFolderPath, error: readError } of fileEntries) {
                if (readError) {
                    invalidFiles.push({ file, valid: false, error: readError.message });
                    continue;
                }
                try {
                    const parsed = JSON.parse(fileContent);
                    const filenameWithoutExt = file.name.replace(/\.json$/i, '').trim();

                    // 1.1 检查是否为拓展自定义备份文件 (含主题与配置，或模块声明)
                    const isCustomBackup = parsed && (
                        parsed._type === 'themeManager_customBackup' ||
                        (Array.isArray(parsed.themes) && parsed.settings && typeof parsed.settings === 'object') ||
                        (parsed._modules && parsed.settings)
                    );

                    // 1.2 检查是否为轻量配置备份文件 (如 theme_manager_config.json)
                    const isSettingsBackup = parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
                        typeof parsed.main_text_color === 'undefined' &&
                        !parsed.themes &&
                        Object.keys(parsed).some(k => typeof k === 'string' && k.startsWith('themeManager_'));

                    if (isCustomBackup || isSettingsBackup) {
                        detectedBackup = parsed;
                        continue;
                    }

                    // 1.3 检查是否为多主题合集数组 [ { main_text_color: ... }, ... ]
                    if (Array.isArray(parsed)) {
                        parsed.forEach((item, idx) => {
                            if (item && typeof item.main_text_color !== 'undefined') {
                                const internalName = (typeof item.name === 'string' && item.name.trim()) ? item.name.trim() : '';
                                const effectiveName = internalName || `${filenameWithoutExt}_${idx + 1}`;
                                item.name = effectiveName;
                                item.value = effectiveName;
                                parsedFiles.push({
                                    file,
                                    themeObject: item,
                                    valid: true,
                                    sourceZip,
                                    zipFolderName,
                                    zipFolderPath
                                });
                            }
                        });
                        continue;
                    }

                    // 1.4 检查是否为单主题包装对象 { themes: [ ... ] }
                    if (parsed && Array.isArray(parsed.themes) && !parsed.settings) {
                        parsed.themes.forEach((item, idx) => {
                            if (item && typeof item.main_text_color !== 'undefined') {
                                const internalName = (typeof item.name === 'string' && item.name.trim()) ? item.name.trim() : '';
                                const effectiveName = internalName || `${filenameWithoutExt}_${idx + 1}`;
                                item.name = effectiveName;
                                item.value = effectiveName;
                                parsedFiles.push({
                                    file,
                                    themeObject: item,
                                    valid: true,
                                    sourceZip,
                                    zipFolderName,
                                    zipFolderPath
                                });
                            }
                        });
                        continue;
                    }

                    // 1.5 标准单主题文件
                    if (parsed && typeof parsed.main_text_color !== 'undefined') {
                        const internalName = (typeof parsed.name === 'string' && parsed.name.trim()) ? parsed.name.trim() : '';
                        const effectiveName = internalName || filenameWithoutExt || '未命名美化';
                        parsed.name = effectiveName;
                        parsed.value = effectiveName;
                        parsedFiles.push({
                            file,
                            themeObject: parsed,
                            valid: true,
                            sourceZip,
                            zipFolderName,
                            zipFolderPath
                        });
                        continue;
                    }

                    invalidFiles.push({ file, valid: false, error: '非有效的主题文件' });
                } catch (err) {
                    invalidFiles.push({ file, valid: false, error: err.message });
                }
            }

            // 若选择的文件中包含备份文件，且未选择其他独立主题文件，直接调起备份恢复向导
            if (detectedBackup && parsedFiles.length === 0) {
                hideLoader();
                if (typeof openCustomImportModal === 'function') {
                    toastr.info('检测到拓展备份文件，已自动打开备份恢复向导。');
                    await openCustomImportModal(detectedBackup);
                } else {
                    toastr.warning('检测到备份文件，请前往【设置】面板中的【备份恢复导入】进行恢复。');
                }
                return;
            }

            // 若同时勾选了备份包与普通主题，将备份包中的主题也提取导入
            if (detectedBackup && Array.isArray(detectedBackup.themes)) {
                detectedBackup.themes.forEach((item, idx) => {
                    if (item && typeof item.main_text_color !== 'undefined') {
                        const internalName = (typeof item.name === 'string' && item.name.trim()) ? item.name.trim() : '';
                        const effectiveName = internalName || `备份主题_${idx + 1}`;
                        item.name = effectiveName;
                        item.value = effectiveName;
                        parsedFiles.push({
                            file: { name: effectiveName },
                            themeObject: item,
                            valid: true,
                            sourceZip: null,
                            zipFolderName: null,
                            zipFolderPath: null
                        });
                    }
                });
            }

            console.log(`[Theme Manager] 开始处理批量导入文件, 选择的文件数: ${files.length}, 解析出有效主题数: ${parsedFiles.length}`);

            const validFiles = parsedFiles.filter(f => f.valid);

            if (invalidFiles.length > 0) {
                invalidFiles.forEach(f => {
                    console.error(`[Theme Manager Error] 无效的主题文件 "${f.file.name}":`, f.error);
                });
            }

            hideLoader();

            if (validFiles.length === 0) {
                toastr.error('所选文件中没有包含有效的主题美化文件。');
                return;
            }

            // 弹窗让用户设置导入的目标标签
            const importConfig = await showImportTagSelectionPopup(validFiles, invalidFiles);
            if (!importConfig) {
                return;
            }

            showLoader();

            let targetTagIds = importConfig.targetTagIds || [];
            let allTags = loadThemeTags();

            // 如果用户在弹窗中选择新建标签
            if (importConfig.newTagName) {
                const targetParentId = importConfig.newTagParentId || null;
                let existingTag = allTags.find(t => 
                    t.name.toLowerCase() === importConfig.newTagName.toLowerCase() && 
                    (t.parentId || null) === targetParentId
                );
                if (!existingTag) {
                    existingTag = {
                        id: Date.now().toString(),
                        name: importConfig.newTagName,
                        parentId: targetParentId,
                        themes: [],
                        keywords: []
                    };
                    allTags.push(existingTag);
                    saveThemeTags(allTags);
                }
                if (!targetTagIds.includes(existingTag.id)) {
                    targetTagIds.push(existingTag.id);
                }
            }

            let successCount = 0;
            let errorCount = invalidFiles.length;
            const importedThemes = [];
            let needsUIUpdate = false;

            // 2. 并行发送 API 保存请求 (限制并发为 10，批量模式下静默保存，避免反复触发布局与重载)
            const saveConcurrency = Math.min(10, Math.max(5, Math.ceil(validFiles.length / 30)));
            console.log(`[Theme Manager] 开始并发保存 ${validFiles.length} 个有效主题 (并发度: ${saveConcurrency})...`);
            
            if (typeof setSuspendObserver === 'function') {
                setSuspendObserver(true);
            }

            const saveResults = await limitConcurrency(saveConcurrency, validFiles, async (item) => {
                try {
                    await saveTheme(item.themeObject, { isBatch: true });
                    return { success: true, themeObject: item.themeObject, item };
                } catch (err) {
                    return { success: false, themeObject: item.themeObject, item, error: err };
                }
            });

            // 收集保存成功的主题
            saveResults.forEach((res, index) => {
                const orig = validFiles[index];
                if (res.status === 'fulfilled' && res.value.success) {
                    successCount++;
                    const th = res.value.themeObject;
                    th._zipFolderName = orig.zipFolderName || null;
                    importedThemes.push(th);
                } else {
                    errorCount++;
                    console.error(`[Theme Manager Error] 保存主题 "${orig.themeObject.name}" 失败:`, res.status === 'fulfilled' ? res.value.error : res.reason);
                }
            });

            // 3. 批量更新下拉框、内存及 UI DOM (一次性处理，消除 N^2 开销)
            if (importedThemes.length > 0) {
                needsUIUpdate = true;

                // 第一步：批量更新 ST 原生下拉框 & 同步内部内存与已知合法美化名称集
                suspendObserver(() => {
                    const existingOptionValues = new Set();
                    if (originalSelect && originalSelect.options) {
                        for (let i = 0; i < originalSelect.options.length; i++) {
                            existingOptionValues.add(originalSelect.options[i].value);
                        }
                    }
                    const optFragment = document.createDocumentFragment();

                    importedThemes.forEach(themeObject => {
                        const cleanTheme = normalizeThemeObject(themeObject, themeObject.name);
                        cleanTheme._zipFolderName = themeObject._zipFolderName || null;
                        if (!existingOptionValues.has(cleanTheme.name)) {
                            const option = document.createElement('option');
                            option.value = cleanTheme.name;
                            option.textContent = cleanTheme.name;
                            optFragment.appendChild(option);
                            existingOptionValues.add(cleanTheme.name);
                        }
                        stKnownThemes.add(cleanTheme.name);
                        allThemeObjectsMap.set(cleanTheme.name, cleanTheme);
                        updateSTThemeMemory(cleanTheme, 'add');
                    });

                    if (originalSelect && optFragment.childNodes.length > 0) {
                        originalSelect.appendChild(optFragment);
                    }
                    syncStKnownThemes();
                });

                // 立即失效主题缓存与合法美化名称缓存，确保后续标签校验认可新导入的主题
                invalidateThemesCache();
                invalidateValidThemeNamesCache();

                // 第二步：如果指定了目标标签或按文件夹自动建标签，批量将美化关联到标签并保存
                const detectedFolders = [...new Set(validFiles.map(f => f.zipFolderName).filter(Boolean))];
                if (targetTagIds.length > 0 || (importConfig.useZipFolderTags && detectedFolders.length > 0)) {
                    allTags = loadThemeTags();

                    const subtagsEnabled = isSubtagsEnabled();
                    if (importConfig.useZipFolderTags && detectedFolders.length > 0) {
                        // 确定子文件夹标签所属父级
                        let folderParentId = null;
                        if (subtagsEnabled) {
                            if (importConfig.newTagName && targetTagIds.length > 0) {
                                folderParentId = targetTagIds[0];
                            } else if (targetTagIds.length === 1) {
                                folderParentId = targetTagIds[0];
                            }
                        }

                        const folderTagMap = new Map();
                        detectedFolders.forEach(folderName => {
                            let existingTag = allTags.find(t => 
                                t.name.toLowerCase() === folderName.toLowerCase() && 
                                (!folderParentId || (t.parentId || null) === folderParentId)
                            );
                            if (!existingTag) {
                                existingTag = {
                                    id: (Date.now() + Math.floor(Math.random() * 100000)).toString(),
                                    name: folderName,
                                    parentId: folderParentId,
                                    themes: [],
                                    keywords: []
                                };
                                allTags.push(existingTag);
                            }
                            folderTagMap.set(folderName, existingTag);
                        });

                        importedThemes.forEach(th => {
                            const folder = th._zipFolderName;
                            if (folder && folderTagMap.has(folder)) {
                                const tag = folderTagMap.get(folder);
                                if (!Array.isArray(tag.themes)) tag.themes = [];
                                if (!tag.themes.includes(th.name)) tag.themes.push(th.name);
                            } else if (targetTagIds.length > 0) {
                                targetTagIds.forEach(tId => {
                                    const tag = allTags.find(t => String(t.id) === String(tId));
                                    if (tag) {
                                        if (!Array.isArray(tag.themes)) tag.themes = [];
                                        if (!tag.themes.includes(th.name)) tag.themes.push(th.name);
                                    }
                                });
                            }
                        });
                    } else if (targetTagIds.length > 0) {
                        const targetTagIdSet = new Set(targetTagIds.map(String));
                        allTags.forEach(tag => {
                            if (targetTagIdSet.has(String(tag.id))) {
                                if (!Array.isArray(tag.themes)) tag.themes = [];
                                const existingThemesSet = new Set(tag.themes);
                                importedThemes.forEach(th => {
                                    if (!existingThemesSet.has(th.name)) {
                                        tag.themes.push(th.name);
                                        existingThemesSet.add(th.name);
                                    }
                                });
                            }
                        });
                    }
                    saveThemeTags(allTags);
                }

                // 第三步：预先读取已包含目标标签的最新标签数据并构建挂载卡片 DOM (预构 tagsMap，利用 Fragment 一次性提交)
                const cachedTags = loadThemeTags();
                const tagsMap = new Map(cachedTags.map(t => [t.id, t]));
                const listFragment = document.createDocumentFragment();
                const list = contentWrapper.querySelector('.theme-list');

                importedThemes.forEach(themeObject => {
                    const cleanTheme = normalizeThemeObject(themeObject, themeObject.name);
                    const themeName = cleanTheme.name;
                    const existingParsed = allParsedThemesMap.get(themeName);
                    const isNewTheme = !existingParsed;

                    if (isNewTheme) {
                        softAddThemeUI(cleanTheme, cachedTags, listFragment, tagsMap);
                    } else {
                        const existingObj = allThemeObjectsMap.get(themeName);
                        if (existingObj) {
                            Object.assign(existingObj, cleanTheme);
                        } else {
                            allThemeObjects.push(cleanTheme);
                            allThemeObjectsMap.set(themeName, cleanTheme);
                        }
                    }
                });

                // 一次性挂载到 DOM，减少 Reflow
                if (list && listFragment.children.length > 0) {
                    list.appendChild(listFragment);
                }

                // 第四步：关键词自动映射（若启用，跳过其内部的中间刷新）
                if (importConfig.applyKeywords && importedThemes.length > 0) {
                    applyKeywordMappings(importedThemes.map(t => t.name), true);
                }

                // 第五步：精准刷新被导入主题的标签展示并依照排序规则刷新列表 (仅执行一次)
                softRefreshUI(importedThemes.map(t => t.name));

                if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                    const ctx = SillyTavern.getContext();
                    if (ctx.saveSettingsDebounced) ctx.saveSettingsDebounced();
                }
            }

            const sourceZips = [...new Set(validFiles.map(f => f.sourceZip).filter(Boolean))];
            let summary = sourceZips.length > 0 
                ? `压缩包导入完成！成功导入 ${successCount} 个美化主题` 
                : `批量导入完成！成功 ${successCount} 个`;

            if (importedThemes.length > 0 && (targetTagIds.length > 0 || importConfig.useZipFolderTags)) {
                const finalTags = loadThemeTags();
                const assignedTagNames = finalTags.filter(t => targetTagIds.includes(String(t.id))).map(t => t.name).join(', ');
                if (assignedTagNames) {
                    summary += `，已分配至标签「${assignedTagNames}」`;
                }
            }
            if (errorCount > 0) {
                summary += `，失败 ${errorCount} 个。`;
                toastr.warning(summary);
            } else {
                summary += '。';
                toastr.success(summary);
            }

            if (needsUIUpdate) {
                updateActiveState();
            }

        } catch (err) {
            console.error('[Theme Manager Error] 批量导入产生未捕获异常:', err);
            toastr.error('导入美化发生异常: ' + (err.message || err));
        } finally {
            if (typeof setSuspendObserver === 'function') {
                setTimeout(() => setSuspendObserver(false), 100);
            }
            hideLoader();
        }
    }

    return {
        showImportTagSelectionPopup,
        handleBatchThemeImport,
        getJSZip
    };
}
