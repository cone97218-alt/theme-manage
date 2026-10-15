/**
 * modules/ai-group.js
 * AI 智能分组模块 (两阶段法：多级树规划 + 批量精准分派)
 * 直接复用酒馆已配置的 API (generateQuietPrompt)
 */

export function initAiGroup(config = {}) {
    const {
        loadThemeTags = () => [],
        saveThemeTags = () => {},
        getAllParsedThemes = () => [],
        getSelectedForBatch = () => new Set(),
        getFilteredThemes = () => [],
        findThemeObject = () => null,
        getCachedThemes = async () => [],
        callGenericPopup,
        closePopup = () => {},
        toastr,
        escapeHtml = (s) => (s || ''),
        showLoader = () => {},
        hideLoader = () => {},
        getAdaptivePopoverBg = () => '#1e2026',
        limitConcurrency = async (c, items, fn) => Promise.allSettled(items.map(fn)),
        softRefreshUI = () => {}
    } = config;

    function escapeAttr(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /**
     * 提取美化的关键色系信息
     */
    function extractThemeColorSummary(themeObj) {
        if (!themeObj || typeof themeObj !== 'object') return '未知色系';
        const colors = [];
        if (themeObj.main_text_color) colors.push(`文本:${themeObj.main_text_color}`);
        if (themeObj.quote_text_color || themeObj.italics_color) colors.push(`高亮:${themeObj.quote_text_color || themeObj.italics_color}`);
        if (themeObj.blur_tint_color || themeObj.chat_tint_color) colors.push(`基调:${themeObj.blur_tint_color || themeObj.chat_tint_color}`);
        if (themeObj.shadow_color) colors.push(`阴影:${themeObj.shadow_color}`);
        return colors.length > 0 ? colors.join(' ') : '默认色彩';
    }

    /**
     * 提取 CSS 头部注释（通常包含作者版权信息、署名与设计声明）
     */
    function extractCssHeaderSnippet(customCss) {
        if (!customCss || typeof customCss !== 'string') return '';
        const trimmed = customCss.trim().slice(0, 600);
        // 1. 尝试匹配头部块级注释 /* ... */
        const blockMatch = trimmed.match(/\/\*[\s\S]*?\*\//);
        if (blockMatch) {
            return blockMatch[0].replace(/\r?\n\s*/g, ' ').slice(0, 220).trim();
        }
        // 2. 尝试匹配头部单行注释 // ...
        const lineMatch = trimmed.match(/^\/\/[^\r\n]+/);
        if (lineMatch) {
            return lineMatch[0].replace(/\r?\n\s*/g, ' ').slice(0, 220).trim();
        }
        // 3. 兜底截取前 120 字符
        return trimmed.slice(0, 120).replace(/\r?\n\s*/g, ' ').trim();
    }

    /**
     * 获取美化主题的完整属性（名称、色系概要、CSS头部注释）
     */
    function getThemeFullDetails(th) {
        if (!th) return { name: '', colors: '默认色彩', cssHeader: '', fullObj: null };
        const name = th.name || th.value || th.display || '';
        let fullObj = (typeof findThemeObject === 'function' ? findThemeObject(name) : null) || th.data || th;

        const colors = extractThemeColorSummary(fullObj);
        const cssHeader = extractCssHeaderSnippet(fullObj?.custom_css || th.custom_css || '');
        return {
            name,
            colors,
            cssHeader,
            fullObj
        };
    }

    /**
     * 格式化已有标签体系作为 Prompt 注入，防止重复建类
     */
    function formatExistingTagsForPrompt(existingTags) {
        if (!Array.isArray(existingTags) || existingTags.length === 0) {
            return '暂无已有标签分类。';
        }
        const roots = existingTags.filter(t => !t.parentId || !existingTags.some(p => p.id === t.parentId));
        const lines = [];

        roots.forEach(root => {
            const children = existingTags.filter(c => c.parentId === root.id);
            if (children.length > 0) {
                const subNames = children.map(c => `${c.name}(${c.themes ? c.themes.length : 0}个)`).join(', ');
                lines.push(`- [主分类] ${root.name} (含子分类: ${subNames})`);
            } else {
                lines.push(`- [主分类] ${root.name} (${root.themes ? root.themes.length : 0}个美化)`);
            }
        });

        return lines.join('\n');
    }

    /**
     * 从 AI 返回的原始文本中安全提取并解析 JSON (支持被截断的 JSON 自动闭合修复)
     */
    function parseJsonFromAi(raw) {
        if (!raw || typeof raw !== 'string') return null;

        let cleaned = raw;
        // 1. 过滤思考标签（如 DeepSeek R1 的 <think> 标签）
        cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

        // 2. 尝试提取 ```json ... ``` 块（即使未闭合 ``` 也能匹配到结尾）
        const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
        if (codeBlockMatch && codeBlockMatch[1]) {
            cleaned = codeBlockMatch[1].trim();
        }

        // 3. 截取首个 { 或 [ 到最后一个 } 或 ]
        const firstBrace = cleaned.indexOf('{');
        const firstBracket = cleaned.indexOf('[');
        let start = -1;

        if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
            start = firstBrace;
        } else if (firstBracket !== -1) {
            start = firstBracket;
        }

        if (start !== -1) {
            cleaned = cleaned.slice(start);
        }

        // 尝试直接解析
        try {
            return JSON.parse(cleaned);
        } catch (_) {}

        // 尝试去除末尾多余逗号后解析
        try {
            return JSON.parse(cleaned.replace(/,\s*([\]}])/g, '$1'));
        } catch (_) {}

        // 4. 自动修复被截断的 JSON (Auto-repair truncated JSON)
        function autoCloseJson(str) {
            let inString = false;
            let isEscaped = false;
            const stack = [];

            for (let i = 0; i < str.length; i++) {
                const ch = str[i];
                if (inString) {
                    if (ch === '\\' && !isEscaped) {
                        isEscaped = true;
                    } else if (ch === '"' && !isEscaped) {
                        inString = false;
                    } else {
                        isEscaped = false;
                    }
                } else {
                    if (ch === '"') {
                        inString = true;
                    } else if (ch === '{') {
                        stack.push('}');
                    } else if (ch === '[') {
                        stack.push(']');
                    } else if (ch === '}' || ch === ']') {
                        if (stack.length > 0 && stack[stack.length - 1] === ch) {
                            stack.pop();
                        }
                    }
                }
            }

            let repaired = str;
            if (inString) {
                repaired += '"';
            }

            // 移除尾部未完成的键值或逗号
            repaired = repaired.replace(/:\s*$/, ': null');
            repaired = repaired.replace(/,\s*$/, '');

            // 依次补齐未闭合的括号
            while (stack.length > 0) {
                const closeChar = stack.pop();
                repaired = repaired.replace(/,\s*$/, '');
                repaired += closeChar;
            }

            return repaired;
        }

        try {
            const repaired = autoCloseJson(cleaned);
            return JSON.parse(repaired);
        } catch (e1) {
            try {
                const fixed = autoCloseJson(cleaned.replace(/,\s*([\]}])/g, '$1'));
                return JSON.parse(fixed);
            } catch (err2) {
                console.error('[AI Group] JSON 解析失败, 原始内容:', raw, err2);
                return null;
            }
        }
    }

    /**
     * 获取独立纯净的 AI 接口调用函数 (优先使用 generateRaw，杜绝注入角色卡、聊天记录与其他拓展提示词)
     */
    function getIndependentAiGenerator() {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const ctx = SillyTavern.getContext();
            // 优先：generateRaw (酒馆原生独立单次推理，完全隔离角色卡、世界书与聊天拓展提示词)
            if (typeof ctx.generateRaw === 'function') {
                return async ({ systemPrompt, userPrompt, responseLength }) => {
                    const res = await ctx.generateRaw({
                        prompt: userPrompt,
                        systemPrompt: systemPrompt || '',
                        responseLength: responseLength || null
                    });
                    return typeof res === 'string' ? res : (res?.text || JSON.stringify(res));
                };
            }
            // 降级备用：generateQuietPrompt
            if (typeof ctx.generateQuietPrompt === 'function') {
                return async ({ systemPrompt, userPrompt, responseLength }) => {
                    const combined = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
                    return await ctx.generateQuietPrompt({
                        quietPrompt: combined,
                        removeReasoning: true,
                        responseLength: responseLength || null
                    });
                };
            }
        }
        return null;
    }

    /**
     * 阶段 1：AI 标签树架构规划 (Tag Tree Architecture Planning)
     */
    async function planTagTreeWithAi({ userDemand, candidateThemes, existingTags, signal }) {
        const aiGenerate = getIndependentAiGenerator();
        if (!aiGenerate) {
            throw new Error('未检测到酒馆 AI 调用接口 (generateRaw / generateQuietPrompt)，请确保酒馆已正常运行。');
        }

        const existingTagsDesc = formatExistingTagsForPrompt(existingTags);

        // 构建美化样本清单（包含名称、色系及 CSS 头部版权/作者声明，以便 AI 提炼作者与风格）
        const sampleThemes = candidateThemes.slice(0, 80);
        const themeSampleLines = sampleThemes.map((t, idx) => {
            const info = getThemeFullDetails(t);
            let line = `${idx + 1}. 名称: "${info.name}" | 色系: [${info.colors}]`;
            if (info.cssHeader) {
                line += ` | CSS注释头部: [${info.cssHeader}]`;
            }
            return line;
        }).join('\n');
        const totalCount = candidateThemes.length;

        const systemPrompt = `你是一位顶级的 UI 美化主题与分类架构专家。
你的任务是根据用户的分类诉求、已有分类体系以及待分类的美化样本，为用户规划一套逻辑严密、多级分明的【父子标签树架构】。

【关键要求】：
1. 支持多维度多视角分类框架：根据用户的要求，分类可以包含不同的顶层维度（例如同时规划【作者】、【设计风格】、【色系基调】等多棵独立的一级主分类树，以便同一个美化可以同时挂载到多个分类下）。
2. 【作者与风格识别】：美化样本中提供了【CSS注释头部】（通常包含作者版权声明，如 /* Author: 千雪 */、/* By xxx */、@作者名、/* 铃兰书摘 by 千雪 */ 等）。若用户要求按作者分类或按风格分类，必须充分利用 CSS 头部注释与美化名称提炼作者名单与风格流派。
3. 【已有分类信息参考】：
${existingTagsDesc}
重要规则：如果用户的分类诉求与已有分类重叠，请优先沿用已有分类或在已有分类下补充二级子标签，严禁凭空创造同义、近似或冗余的重复主标签！
4. 【极简紧凑输出规范（极其重要）】：
- 每个一级主类包含 rootName 与 children 纯字符串数组。
- 严禁输出 criteria 或任何长篇解释！只输出标签名称字符串，保持紧凑，确保 JSON 简短完整、绝不超长截断！
- 主分类数量控制在 3~5 个，每个主分类下的子分类控制在 2~6 个。
5. 输出格式要求：只输出合法的 JSON 对象，严禁包含任何前言、后记、Markdown 解释或多余符号。

【JSON 返回格式范例】：
{
  "tagTree": [
    {
      "rootName": "作者",
      "children": ["千雪", "小林", "夜猫"]
    },
    {
      "rootName": "设计风格",
      "children": ["古风水墨", "现代极简", "赛博霓虹", "毛玻璃拟态"]
    },
    {
      "rootName": "色系基调",
      "children": ["深色夜间", "素雅明亮", "马卡龙淡彩"]
    }
  ]
}`;

        const userPrompt = `待分类的美化主题共 ${totalCount} 个。
美化主题样本包含（名称、色系及 CSS 头部注释版权信息）：
${themeSampleLines}${totalCount > 80 ? `\n...（等共 ${totalCount} 个美化主题）` : ''}

【用户的分类需求】：
${userDemand || '请根据美化名称、视觉风格、作者信息（重点参考CSS头部注释中的作者声明）及色系特征，自动归纳出最清晰科学的父子标签体系（支持作者分类与风格分类等不同维度并存）。'}

请立即输出规划好的父子标签树 JSON：`;

        const rawResult = await aiGenerate({
            systemPrompt: systemPrompt,
            userPrompt: userPrompt,
            responseLength: null
        });

        const parsed = parseJsonFromAi(rawResult);
        if (!parsed || !Array.isArray(parsed.tagTree) || parsed.tagTree.length === 0) {
            throw new Error('AI 未能返回有效的分类树结构，请重试或修改分类诉求。');
        }

        // 标准化 children 节点 (支持纯字符串数组与对象数组)
        return parsed.tagTree.map(root => {
            const rawChildren = Array.isArray(root.children) ? root.children : [];
            const normalizedChildren = rawChildren.map(c => {
                if (typeof c === 'string') return { name: c.trim() };
                if (c && typeof c === 'object') return { name: (c.name || c.title || String(c)).trim() };
                return { name: String(c).trim() };
            }).filter(c => Boolean(c.name));

            return {
                rootName: (root.rootName || root.name || '未命名分类').trim(),
                children: normalizedChildren
            };
        }).filter(r => Boolean(r.rootName));
    }

    /**
     * 阶段 2：将美化分批精确分配至已规划的标签树节点（支持一个美化挂载多个分类）
     */
    async function assignThemesToTreeWithAi({ tagTree, batchThemes, userDemand, existingTags, batchIndex, totalBatches, onProgress }) {
        const aiGenerate = getIndependentAiGenerator();
        if (!aiGenerate) throw new Error('未检测到酒馆 AI 调用接口');

        // 将规划好的标签树压缩为紧凑说明
        const treeStructureText = tagTree.map(root => {
            const subs = (root.children || []).map(c => `"${c.name || c}"`).join(', ');
            return `- 主分类 [${root.rootName}] -> 子分类: [${subs || '无子分类'}]`;
        }).join('\n');

        // 构建当前批次的美化详单（名称 + 色系 + CSS 版权头）
        const themesDetailList = batchThemes.map((t, idx) => {
            const info = getThemeFullDetails(t);
            let line = `${idx + 1}. 名称: "${info.name}" | 色系: [${info.colors}]`;
            if (info.cssHeader) {
                line += ` | CSS注释头部: [${info.cssHeader}]`;
            }
            return line;
        }).join('\n');

        const systemPrompt = `你是一位细致的美化归类助理。
必须将以下给定的美化主题，精准分配到预先规划好的父子标签体系中。

【可用分类架构】：
${treeStructureText}

【用户特别要求】：
${userDemand || '标准客观归类'}

【归类参考依据与作者识别原则】：
1. CSS注释头部：美化作者通常会在 CSS 最前端以注释声明作者或版权（例如 /* Author: 千雪 */、/* By xxx */、@作者名、/* 铃兰书摘 by 千雪 */ 等）。【若规划体系中存在作者分类，必须优先提取 CSS 注释头部或名称中的作者信息，将其归入对应的作者子标签】！
2. 美化名称：通常包含风格、色系、特定系列或作者署名（例如带有 @xxx 或 【日间/夜间】）。
3. 色系信息：提供了文本、高亮、模糊基调等色彩参数，辅助归类色彩与明暗风格。

【规则】：
1. 【支持多维度交叉归类】：如果一个美化主题既符合某个作者（例如作者A），又具有特定风格（例如古风水墨或现代极简）或色系，**必须在 categories 数组中同时提供多个分类对象**，使其同时归属至这几个分类！
2. 每个分类对象包含 "root" (主分类) 和 "sub" (子分类)。若无法匹配具体的二级子分类，sub 可填与 root 相同或留空字符串 ""。
3. 严格输出纯 JSON 对象，格式如下：
{
  "assignments": [
    {
      "theme": "水墨兰亭·夜",
      "categories": [
        { "root": "作者", "sub": "千雪" },
        { "root": "设计风格", "sub": "古风水墨" },
        { "root": "色系基调", "sub": "深色夜间" }
      ]
    },
    {
      "theme": "Minimal Light",
      "categories": [
        { "root": "设计风格", "sub": "现代极简" },
        { "root": "色系基调", "sub": "素雅明亮" }
      ]
    }
  ]
}`;

        const userPrompt = `请对以下第 ${batchIndex + 1}/${totalBatches} 批美化进行归类分配：\n${themesDetailList}\n\n输出纯 JSON：`;

        if (typeof onProgress === 'function') {
            onProgress({ batchIndex, totalBatches, status: 'generating' });
        }

        const rawResult = await aiGenerate({
            systemPrompt: systemPrompt,
            userPrompt: userPrompt,
            responseLength: null
        });

        const parsed = parseJsonFromAi(rawResult);
        const assignments = (parsed && Array.isArray(parsed.assignments)) ? parsed.assignments : [];

        // 校验并展开多分类，补充兜底
        const resultItems = [];
        batchThemes.forEach(th => {
            const name = th.name || th.value;
            const matched = assignments.find(a => a && (a.theme === name || a.theme?.trim() === name.trim()));
            if (matched) {
                // 如果返回了 categories 数组（多维度多标签）
                if (Array.isArray(matched.categories) && matched.categories.length > 0) {
                    matched.categories.forEach(cat => {
                        if (cat && cat.root) {
                            resultItems.push({
                                theme: name,
                                root: cat.root.trim(),
                                sub: (cat.sub || '').trim(),
                                rawTheme: th
                            });
                        }
                    });
                    return;
                }
                // 兼容单一 root/sub 结构
                if (matched.root) {
                    resultItems.push({
                        theme: name,
                        root: matched.root.trim(),
                        sub: (matched.sub || '').trim(),
                        rawTheme: th
                    });
                    return;
                }
            }
            // 兜底至规划树的首个默认分类
            const defaultRoot = tagTree[0]?.rootName || '其他美化';
            const defaultSub = tagTree[0]?.children?.[0]?.name || '';
            resultItems.push({
                theme: name,
                root: defaultRoot,
                sub: defaultSub,
                rawTheme: th
            });
        });

        return resultItems;
    }

    /**
     * 渲染 AI 智能分组 Tab 的完整 UI
     */
    function renderAiGroupTabContent(container, helpers = {}) {
        if (!container) return;

        const popoverBg = getAdaptivePopoverBg();
        const existingTags = loadThemeTags() || [];
        const allThemes = getAllParsedThemes() || [];
        const selectedThemes = getSelectedForBatch() || new Set();
        const filteredThemes = getFilteredThemes() || [];

        const uncatCount = allThemes.filter(th => {
            const name = th.name || th.value;
            return !existingTags.some(tag => Array.isArray(tag.themes) && tag.themes.includes(name));
        }).length;

        const selectedCount = selectedThemes.size;
        const filteredCount = filteredThemes.length;
        const totalCount = allThemes.length;

        container.innerHTML = `
            <div class="tm-ai-group-wrapper" style="width:100%; max-width:100%; height:100%; box-sizing:border-box; overflow:hidden; writing-mode:horizontal-tb !important; display:flex; flex-direction:column; gap:12px; color:var(--SmartThemeBodyColor, inherit); background:transparent;">
                
                <!-- 1. 配置输入区 -->
                <div id="tm-ai-config-section" style="display:flex; flex-direction:column; gap:12px;">
                    <!-- 范围选择 -->
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        <label style="font-size:12.5px; opacity:0.9; display:flex; align-items:center; gap:6px; color:var(--SmartThemeBodyColor, inherit);">
                            <i class="fa-solid fa-layer-group" style="color:var(--SmartThemeQuoteColor, #4a90e2);"></i>
                            <span>选择参与 AI 分析的美化范围：</span>
                        </label>
                        <select id="tm-ai-scope-select" class="text_pole" style="width:100%; height:32px; font-size:12px; box-sizing:border-box; margin:0; border-radius:4px; background:transparent; color:var(--SmartThemeBodyColor, inherit); border:1px solid var(--SmartThemeBorderColor, rgba(128,128,128,0.25));">
                            <option value="all">全量美化主题 (共 ${totalCount} 个)</option>
                            <option value="uncat" ${uncatCount > 0 ? 'selected' : ''}>仅尚未分类的美化 (共 ${uncatCount} 个)</option>
                            ${selectedCount > 0 ? `<option value="selected">当前选中的美化 (共 ${selectedCount} 个)</option>` : ''}
                            ${filteredCount > 0 && filteredCount < totalCount ? `<option value="filtered">当前视图筛选的美化 (共 ${filteredCount} 个)</option>` : ''}
                        </select>
                    </div>

                    <!-- 诉求输入 -->
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        <label style="font-size:12.5px; opacity:0.9; display:flex; align-items:center; gap:6px; color:var(--SmartThemeBodyColor, inherit);">
                            <i class="fa-solid fa-brain" style="color:var(--SmartThemeQuoteColor, #4a90e2);"></i>
                            <span>输入您的分类需求概述：</span>
                        </label>
                        <textarea id="tm-ai-demand-input" class="text_pole" rows="3" placeholder="例如：按作者分类（作者A/作者B），同时按风格分类（古风水墨/现代极简/赛博朋克）；支持一个美化同时归入多个分类..." style="width:100%; font-size:12px; box-sizing:border-box; margin:0; padding:6px 8px; border-radius:4px; resize:vertical; background:transparent; color:var(--SmartThemeBodyColor, inherit); min-height:65px; border:1px solid var(--SmartThemeBorderColor, rgba(128,128,128,0.25));"></textarea>
                    </div>

                    <!-- 启动按钮 (纯图标 + title) -->
                    <div style="display:flex; justify-content:flex-end;">
                        <button id="tm-ai-start-btn" class="menu_button" style="background:var(--SmartThemeQuoteColor, #4a90e2) !important; color:#ffffff !important; border:none; padding:7px 20px; font-size:13px; font-weight:bold; border-radius:4px; display:inline-flex; align-items:center; justify-content:center; cursor:pointer;" title="开始 AI 智能两阶段分组">
                            <i class="fa-solid fa-wand-magic-sparkles"></i>
                        </button>
                    </div>
                </div>

                <!-- 2. 执行状态与进度面板 (默认隐藏) -->
                <div id="tm-ai-progress-panel" style="display:none; border:1px solid var(--SmartThemeBorderColor, rgba(128,128,128,0.25)); border-radius:6px; background:transparent; padding:12px; flex-direction:column; gap:8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span id="tm-ai-progress-title" style="font-size:12.5px; font-weight:bold; color:var(--SmartThemeQuoteColor, #4a90e2); display:flex; align-items:center; gap:6px;">
                            <i class="fa-solid fa-spinner fa-spin"></i>
                            <span>AI 正在思考规划中...</span>
                        </span>
                        <span id="tm-ai-progress-percent" style="font-size:11.5px; opacity:0.8;">0%</span>
                    </div>
                    <div style="width:100%; height:6px; background:rgba(128,128,128,0.2); border-radius:3px; overflow:hidden;">
                        <div id="tm-ai-progress-bar" style="width:5%; height:100%; background:var(--SmartThemeQuoteColor, #4a90e2); transition:width 0.3s;"></div>
                    </div>
                    <div id="tm-ai-progress-desc" style="font-size:11.5px; opacity:0.75; font-family:monospace; word-break:break-all;">准备启动两阶段规划...</div>
                </div>

                <!-- 3. AI 结果全景卡片折叠矩阵 (生成后展示，撑满容器并支持纵向滚动) -->
                <div id="tm-ai-results-panel" style="display:none; flex:1; min-height:0; height:100%; flex-direction:column; gap:8px; overflow:hidden;">
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:2px 2px; flex-shrink:0; border-bottom:1px solid var(--SmartThemeBorderColor, rgba(128,128,128,0.15)); padding-bottom:6px;">
                        <span style="font-size:13px; font-weight:bold; color:var(--SmartThemeQuoteColor, #4a90e2); display:inline-flex; align-items:center; gap:6px;">
                            <i class="fa-solid fa-sitemap"></i>
                            <span>AI 分类成果预览</span>
                        </span>
                        <div style="display:flex; gap:6px; align-items:center;">
                            <button id="tm-ai-reconfig-btn" class="menu_button" style="padding:4px 10px; font-size:12px; border-radius:4px; display:inline-flex; align-items:center; justify-content:center; cursor:pointer;" title="返回重新调整分类诉求">
                                <i class="fa-solid fa-arrow-left"></i>
                            </button>
                            <button id="tm-ai-confirm-apply-btn" class="menu_button" style="background:var(--SmartThemeQuoteColor, #4a90e2) !important; color:#ffffff !important; border:none; padding:4px 14px; font-size:12px; font-weight:bold; border-radius:4px; display:inline-flex; align-items:center; justify-content:center; cursor:pointer;" title="应用全部 AI 分类到系统">
                                <i class="fa-solid fa-check-double"></i>
                            </button>
                        </div>
                    </div>

                    <!-- 动态注入的分类折叠条树 (独立全高纵向滚动容器) -->
                    <div id="tm-ai-groups-tree-container" style="display:flex; flex-direction:column; gap:8px; flex:1; min-height:0; overflow-y:auto !important; padding-right:4px; padding-bottom:30px;"></div>
                </div>

            </div>
        `;

        // 绑定启动 AI 分析按钮
        const startBtn = container.querySelector('#tm-ai-start-btn');
        if (startBtn) {
            startBtn.addEventListener('click', async () => {
                await executeAiGroupPipeline(container);
            });
        }
    }

    /**
     * 核心两阶段执行流水线
     */
    async function executeAiGroupPipeline(container) {
        const scopeSelect = container.querySelector('#tm-ai-scope-select');
        const demandInput = container.querySelector('#tm-ai-demand-input');
        const progressPanel = container.querySelector('#tm-ai-progress-panel');
        const progressBar = container.querySelector('#tm-ai-progress-bar');
        const progressPercent = container.querySelector('#tm-ai-progress-percent');
        const progressTitle = container.querySelector('#tm-ai-progress-title');
        const progressDesc = container.querySelector('#tm-ai-progress-desc');
        const resultsPanel = container.querySelector('#tm-ai-results-panel');
        const configSection = container.querySelector('#tm-ai-config-section');
        const startBtn = container.querySelector('#tm-ai-start-btn');

        const scope = scopeSelect ? scopeSelect.value : 'all';
        const userDemand = demandInput ? demandInput.value.trim() : '';

        // 收集待分类美化清单
        const allThemes = getAllParsedThemes() || [];
        const existingTags = loadThemeTags() || [];
        let pool = [];

        if (scope === 'uncat') {
            pool = allThemes.filter(th => {
                const name = th.name || th.value;
                return !existingTags.some(tag => Array.isArray(tag.themes) && tag.themes.includes(name));
            });
        } else if (scope === 'selected') {
            const selectedSet = getSelectedForBatch() || new Set();
            pool = allThemes.filter(th => selectedSet.has(th.name || th.value));
        } else if (scope === 'filtered') {
            pool = getFilteredThemes() || allThemes;
        } else {
            pool = allThemes;
        }

        if (pool.length === 0) {
            toastr.warning('所选范围内没有找到可供分析的美化主题。');
            return;
        }

        // 展开进度面板，禁用启动按钮
        if (progressPanel) progressPanel.style.display = 'flex';
        if (resultsPanel) resultsPanel.style.display = 'none';
        if (startBtn) startBtn.disabled = true;

        try {
            // 预热并确保全量美化数据已加载（包含 custom_css 与详细颜色对象）
            if (typeof getCachedThemes === 'function') {
                try {
                    await getCachedThemes();
                } catch (e) {
                    console.warn('[AI Group] 预缓存美化详细数据异常 (降级使用现有内存):', e);
                }
            }

            // === 阶段 1：标签树规划 ===
            if (progressTitle) progressTitle.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>阶段 1/2：规划多级标签树...</span>';
            if (progressBar) progressBar.style.width = '20%';
            if (progressPercent) progressPercent.textContent = '20%';
            if (progressDesc) progressDesc.textContent = `正在结合分类诉求与现有 ${existingTags.length} 个标签，为 ${pool.length} 个美化构建树形结构...`;

            const plannedTree = await planTagTreeWithAi({
                userDemand,
                candidateThemes: pool,
                existingTags
            });

            console.log('[AI Group] 阶段 1 规划的标签树:', plannedTree);

            // === 阶段 2：批量精准分配 ===
            if (progressTitle) progressTitle.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>阶段 2/2：将美化分配至具体标签...</span>';
            const BATCH_SIZE = 35;
            const totalBatches = Math.ceil(pool.length / BATCH_SIZE);
            let allAssignments = [];

            for (let b = 0; b < totalBatches; b++) {
                const chunk = pool.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
                const currentPct = 20 + Math.floor(((b + 1) / totalBatches) * 75);
                if (progressBar) progressBar.style.width = `${currentPct}%`;
                if (progressPercent) progressPercent.textContent = `${currentPct}%`;
                if (progressDesc) progressDesc.textContent = `正在归类第 ${b + 1}/${totalBatches} 批美化 (${chunk.length} 个)...`;

                const chunkResult = await assignThemesToTreeWithAi({
                    tagTree: plannedTree,
                    batchThemes: chunk,
                    userDemand,
                    existingTags,
                    batchIndex: b,
                    totalBatches
                });

                allAssignments.push(...chunkResult);
            }

            if (progressBar) progressBar.style.width = '100%';
            if (progressPercent) progressPercent.textContent = '100%';
            if (progressTitle) progressTitle.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#28a745;"></i> <span>AI 分类完成！</span>';
            if (progressDesc) progressDesc.textContent = `成功规划了 ${plannedTree.length} 个根主类，归类了 ${allAssignments.length} 个美化主题。`;

            // 隐藏输入区，腾出完整高度给全景结果与纵向滚动
            if (configSection) configSection.style.display = 'none';
            if (progressPanel) progressPanel.style.display = 'none';

            // 渲染全景审核矩阵
            renderAiReviewTree(container, plannedTree, allAssignments);

        } catch (err) {
            console.error('[AI Group] 运行流水线异常:', err);
            toastr.error('AI 分组发生错误: ' + (err.message || err));
            if (progressTitle) progressTitle.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#dc3545;"></i> <span>分析失败</span>';
            if (progressDesc) progressDesc.textContent = err.message || '网络或接口异常';
        } finally {
            if (startBtn) startBtn.disabled = false;
        }
    }

    /**
     * 渲染审核矩阵：折叠栏展示父标签、子标签及具体主题卡片 (无灰底纯净自适应样式)
     */
    function renderAiReviewTree(container, plannedTree, assignments) {
        const resultsPanel = container.querySelector('#tm-ai-results-panel');
        const treeContainer = container.querySelector('#tm-ai-groups-tree-container');
        const confirmBtn = container.querySelector('#tm-ai-confirm-apply-btn');
        const reconfigBtn = container.querySelector('#tm-ai-reconfig-btn');
        const configSection = container.querySelector('#tm-ai-config-section');

        if (!resultsPanel || !treeContainer) return;
        resultsPanel.style.display = 'flex';
        treeContainer.innerHTML = '';

        // 绑定返回重新配置
        if (reconfigBtn) {
            reconfigBtn.onclick = () => {
                if (configSection) configSection.style.display = 'flex';
                resultsPanel.style.display = 'none';
            };
        }

        // 1. 构建全景分类树结构（合并阶段 1 规划与阶段 2 实际产出的主分类，杜绝任何美化丢失）
        const effectiveTree = [...plannedTree];
        const existingRootNames = new Set(plannedTree.map(r => (r.rootName || '').trim().toLowerCase()));
        assignments.forEach(a => {
            const rName = (a.root || '').trim();
            if (rName && !existingRootNames.has(rName.toLowerCase())) {
                existingRootNames.add(rName.toLowerCase());
                effectiveTree.push({
                    rootName: rName,
                    children: a.sub ? [{ name: a.sub.trim() }] : []
                });
            }
        });

        // 2. 按根标签聚合美化
        effectiveTree.forEach((rootNode, rootIdx) => {
            const rootName = (rootNode.rootName || '').trim();
            const rootThemes = assignments.filter(a => (a.root || '').trim().toLowerCase() === rootName.toLowerCase());
            if (rootThemes.length === 0) return;

            // 动态聚合该主分类下的所有子标签（规划的 + 实际分配的）
            const plannedSubNames = (rootNode.children || []).map(c => typeof c === 'string' ? c.trim() : (c.name || '').trim()).filter(Boolean);
            const actualSubNames = rootThemes.map(a => (a.sub || '').trim()).filter(Boolean);
            const allSubNames = Array.from(new Set([...plannedSubNames, ...actualSubNames]));

            // 分离出没有子标签的直属美化
            const directThemes = rootThemes.filter(a => !(a.sub || '').trim() || (a.sub || '').trim().toLowerCase() === rootName.toLowerCase());

            const rootBox = document.createElement('div');
            rootBox.className = 'tm-ai-root-group-card';
            rootBox.style.cssText = `border:1px solid var(--SmartThemeBorderColor, rgba(128,128,128,0.25)); border-radius:6px; background:transparent; overflow:hidden; margin-bottom:8px; flex-shrink:0;`;

            // 一级折叠条 Header (透明背景 + 细边框)
            const rootHeader = document.createElement('div');
            rootHeader.style.cssText = `padding:8px 10px; background:transparent; display:flex; justify-content:space-between; align-items:center; cursor:pointer; user-select:none; border-bottom:1px solid var(--SmartThemeBorderColor, rgba(128,128,128,0.15));`;
            rootHeader.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px;">
                    <i class="fa-solid fa-folder-tree" style="color:var(--SmartThemeQuoteColor, #4a90e2);"></i>
                    <input type="text" class="tm-ai-root-name-input text_pole" value="${escapeHtml(rootName)}" style="height:24px; font-size:12px; font-weight:bold; padding:1px 6px; margin:0; width:130px; background:transparent; color:var(--SmartThemeBodyColor, inherit); border:1px solid var(--SmartThemeBorderColor, rgba(128,128,128,0.25)); border-radius:4px;" title="点击可直接编辑修改主标签名称" />
                    <span style="font-size:11px; opacity:0.7;">(${rootThemes.length})</span>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <i class="fa-solid fa-chevron-down tm-ai-root-fold-icon" style="color:var(--SmartThemeQuoteColor, #4a90e2); font-size:11px; transition:transform 0.2s;" title="展开/收起"></i>
                </div>
            `;

            // 一级折叠条 Body
            const rootBody = document.createElement('div');
            rootBody.style.cssText = `padding:8px; display:flex; flex-direction:column; gap:6px; background:transparent;`;

            // 渲染二级子标签卡片
            if (allSubNames.length > 0) {
                allSubNames.forEach((subName, subIdx) => {
                    const subThemes = rootThemes.filter(a => (a.sub || '').trim().toLowerCase() === subName.toLowerCase());
                    if (subThemes.length === 0) return;

                    const subCard = document.createElement('div');
                    subCard.className = 'tm-ai-sub-group-card';
                    subCard.style.cssText = `background:transparent; border:1px solid var(--SmartThemeBorderColor, rgba(128,128,128,0.18)); border-radius:4px; padding:6px 8px; display:flex; flex-direction:column; gap:4px;`;

                    subCard.innerHTML = `
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div style="display:flex; align-items:center; gap:6px;">
                                <i class="fa-solid fa-tag" style="font-size:10px; color:var(--SmartThemeQuoteColor, #4a90e2);"></i>
                                <input type="text" class="tm-ai-sub-name-input text_pole" data-root-idx="${rootIdx}" value="${escapeHtml(subName)}" style="height:22px; font-size:11.5px; padding:1px 6px; margin:0; width:120px; background:transparent; color:var(--SmartThemeBodyColor, inherit); border:1px solid var(--SmartThemeBorderColor, rgba(128,128,128,0.2)); border-radius:3px;" title="编辑子标签名" />
                                <span style="font-size:10.5px; opacity:0.65;">${subThemes.length}个</span>
                            </div>
                        </div>
                        <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:3px;">
                            ${subThemes.map(st => `
                                <label style="display:inline-flex; align-items:center; gap:4px; padding:2px 6px; border:1px solid var(--SmartThemeBorderColor, rgba(128,128,128,0.2)); border-radius:3px; font-size:11px; cursor:pointer; background:transparent; color:var(--SmartThemeBodyColor, inherit);" title="${escapeAttr(st.theme)}">
                                    <input type="checkbox" class="tm-ai-theme-chk" data-theme="${escapeAttr(st.theme)}" checked style="margin:0; width:12px; height:12px;" />
                                    <span style="max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(st.theme)}</span>
                                </label>
                            `).join('')}
                        </div>
                    `;
                    rootBody.appendChild(subCard);
                });
            }

            // 渲染直属美化卡片（若存在没有二级子标签的美化）
            if (directThemes.length > 0) {
                const directCard = document.createElement('div');
                directCard.className = 'tm-ai-direct-group-card';
                directCard.style.cssText = `background:transparent; border:1px dashed var(--SmartThemeBorderColor, rgba(128,128,128,0.18)); border-radius:4px; padding:6px 8px; display:flex; flex-direction:column; gap:4px;`;
                directCard.innerHTML = `
                    <div style="font-size:11px; opacity:0.75; display:flex; align-items:center; gap:4px;">
                        <i class="fa-solid fa-circle-dot" style="font-size:8px; color:var(--SmartThemeQuoteColor, #4a90e2);"></i>
                        <span>直属美化 (${directThemes.length}个)</span>
                    </div>
                    <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:2px;">
                        ${directThemes.map(dt => `
                            <label style="display:inline-flex; align-items:center; gap:4px; padding:2px 6px; border:1px solid var(--SmartThemeBorderColor, rgba(128,128,128,0.2)); border-radius:3px; font-size:11px; cursor:pointer; background:transparent; color:var(--SmartThemeBodyColor, inherit);" title="${escapeAttr(dt.theme)}">
                                <input type="checkbox" class="tm-ai-theme-chk" data-theme="${escapeAttr(dt.theme)}" checked style="margin:0; width:12px; height:12px;" />
                                <span style="max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(dt.theme)}</span>
                            </label>
                        `).join('')}
                    </div>
                `;
                rootBody.appendChild(directCard);
            }

            // 阻止输入框冒泡触发折叠
            rootHeader.querySelector('.tm-ai-root-name-input').addEventListener('click', e => e.stopPropagation());

            // 折叠交互
            const rootFoldIcon = rootHeader.querySelector('.tm-ai-root-fold-icon');
            rootHeader.addEventListener('click', () => {
                const isHidden = rootBody.style.display === 'none';
                rootBody.style.display = isHidden ? 'flex' : 'none';
                rootFoldIcon.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
            });

            rootBox.appendChild(rootHeader);
            rootBox.appendChild(rootBody);
            treeContainer.appendChild(rootBox);
        });

        // 一键应用并持久化标签与美化关联
        if (confirmBtn) {
            confirmBtn.onclick = () => {
                applyAiClassificationToSystem(container, effectiveTree, assignments);
            };
        }
    }

    /**
     * 将用户在全景矩阵中确认的父子标签和美化关系保存至系统
     */
    function applyAiClassificationToSystem(container, plannedTree, assignments) {
        showLoader();
        try {
            let allTags = loadThemeTags() || [];
            let createdCount = 0;
            let linkedCount = 0;
            const affectedThemes = new Set();

            const treeContainer = container.querySelector('#tm-ai-groups-tree-container');
            const rootCards = treeContainer ? treeContainer.querySelectorAll('.tm-ai-root-group-card') : [];

            rootCards.forEach((rc, rIdx) => {
                const rootNameInput = rc.querySelector('.tm-ai-root-name-input');
                const rootName = (rootNameInput ? rootNameInput.value.trim() : plannedTree[rIdx]?.rootName) || `AI主分类_${rIdx + 1}`;

                // 查找或创建一级主标签
                let rootTag = allTags.find(t => t.name.toLowerCase() === rootName.toLowerCase() && !t.parentId);
                if (!rootTag) {
                    rootTag = {
                        id: `ai_${Date.now()}_r${rIdx}_${Math.random().toString(36).substr(2, 4)}`,
                        name: rootName,
                        parentId: null,
                        themes: [],
                        keywords: []
                    };
                    allTags.push(rootTag);
                    createdCount++;
                }
                if (!Array.isArray(rootTag.themes)) rootTag.themes = [];
                const rootThemesSet = new Set(rootTag.themes);

                // 1. 处理二级子标签卡片
                const subCards = rc.querySelectorAll('.tm-ai-sub-group-card');
                subCards.forEach((subCard, sIdx) => {
                    const sInput = subCard.querySelector('.tm-ai-sub-name-input');
                    const subName = (sInput ? sInput.value.trim() : '') || `AI子分类_${sIdx + 1}`;

                    let subTag = allTags.find(t => t.name.toLowerCase() === subName.toLowerCase() && t.parentId === rootTag.id);
                    if (!subTag) {
                        subTag = {
                            id: `ai_${Date.now()}_s${rIdx}_${sIdx}_${Math.random().toString(36).substr(2, 4)}`,
                            name: subName,
                            parentId: rootTag.id,
                            themes: [],
                            keywords: []
                        };
                        allTags.push(subTag);
                        createdCount++;
                    }
                    if (!Array.isArray(subTag.themes)) subTag.themes = [];
                    const subThemesSet = new Set(subTag.themes);

                    // 精准从当前子标签卡片下收集勾选的美化
                    const checkedChks = subCard.querySelectorAll('.tm-ai-theme-chk:checked');
                    checkedChks.forEach(cb => {
                        const thName = cb.dataset.theme;
                        if (!thName) return;
                        affectedThemes.add(thName);

                        if (!subThemesSet.has(thName)) {
                            subTag.themes.push(thName);
                            subThemesSet.add(thName);
                            linkedCount++;
                        }
                        if (!rootThemesSet.has(thName)) {
                            rootTag.themes.push(thName);
                            rootThemesSet.add(thName);
                        }
                    });
                });

                // 2. 处理直接挂载到主分类的美化（不在任何 .tm-ai-sub-group-card 内的勾选框）
                const allCheckedChks = rc.querySelectorAll('.tm-ai-theme-chk:checked');
                allCheckedChks.forEach(cb => {
                    if (!cb.closest('.tm-ai-sub-group-card')) {
                        const thName = cb.dataset.theme;
                        if (!thName) return;
                        affectedThemes.add(thName);

                        if (!rootThemesSet.has(thName)) {
                            rootTag.themes.push(thName);
                            rootThemesSet.add(thName);
                            linkedCount++;
                        }
                    }
                });
            });

            console.log(`[AI Group] 保存标签关联: 总标签数=${allTags.length}, 新建标签=${createdCount}, 关联操作=${linkedCount}, 涉及美化=${affectedThemes.size}`);
            saveThemeTags(allTags);
            softRefreshUI(null);

            toastr.success(`🎉 AI 智能分组已生效！创建/更新了 ${createdCount} 个分类标签，成功将 ${affectedThemes.size} 个美化归入对应标签。`);

            // 成功后关闭向导弹窗
            setTimeout(() => {
                const dlg = container.closest('.popup') || container.closest('dialog') || document.querySelector('.popup:has(#tm-tab-content-ai)');
                if (dlg) {
                    if (typeof closePopup === 'function') {
                        closePopup(dlg);
                    }
                    const cancelBtn = dlg.querySelector('.popup-button-cancel') || dlg.querySelector('.popup-button-close');
                    if (cancelBtn) cancelBtn.click();
                    else if (typeof dlg.close === 'function') dlg.close();
                }
            }, 300);
        } catch (err) {
            console.error('[AI Group] 保存分类异常:', err);
            toastr.error('应用分类保存失败: ' + (err.message || err));
        } finally {
            hideLoader();
        }
    }

    return {
        renderAiGroupTabContent,
        planTagTreeWithAi,
        assignThemesToTreeWithAi,
        extractThemeColorSummary,
        extractCssHeaderSnippet,
        formatExistingTagsForPrompt,
        parseJsonFromAi
    };
}
