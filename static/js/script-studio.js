(function () {
    'use strict';

    const tr = (key) => (window.StudioI18n ? window.StudioI18n.t(key) : key);
    const tf = (key, vars) => tr(key).replace(/\{(\w+)\}/g, (match, name) => (
        vars && Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
    ));
    const $ = (id) => document.getElementById(id);
    const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
    ));
    const jsonHeaders = { 'Content-Type': 'application/json' };
    // 生成设置默认选中的平台与模型（找不到时回退到首选平台 / 列表第一项）
    const DEFAULT_PROVIDER_ID = 'deepseek';
    const DEFAULT_MODEL_HINTS = ['deepseek-flash', 'v4-flash', 'flash'];

    const state = {
        templates: [],
        templateId: '',
        templateOriginal: '',
        // 人物与场景提取（第一步）
        castTemplates: [],
        castTemplateId: '',
        // 画风：人物/场景/道具与分镜共用，随剧本一起存取
        styles: [],
        styleId: '',
        castRunning: false,
        castController: null,
        // 人物、场景与道具参考图（右侧画廊）
        castItems: { character: [], scene: [], prop: [] },
        // 「人物清单 / 场景清单 / 道具清单」里声明的中英别名：{ 归一化主名: [别名…] }
        castAliases: {},
        castShots: {},
        // 画廊里人物 / 场景 / 道具三组各自的折叠状态
        castCollapsed: { character: false, scene: false, prop: false },
        // 这三类里已经生成过清单的类型（「检查漏掉的条目」按钮按它决定显不显示）：
        // 用「生成过」而不是「文本框非空」，因为道具可能本来就没有，非空判断会让按钮永远不出现
        castKinds: { character: false, scene: false, prop: false },
        imageProviders: [],
        imageProviderId: '',
        imageModel: '',
        imageEngine: 'comfy',
        imageRatio: '3:2',
        imageResolution: '1k',
        // ComfyUI 工作流生图
        castComfyWorkflows: [],
        // 人物 / 场景 / 道具各记一个工作流：人物是一条链（生角色出图 → 人物三视图出三视图），场景另一套
        castComfyWorkflowByKind: { character: '', scene: '', prop: '' },
        castComfyCache: {},
        castComfySizeReady: null,
        imageRunning: false,
        imageAbort: false,
        providers: [],
        providerId: '',
        model: '',
        results: [],
        running: false,
        controller: null,
        // 分段生成的中断点：点「停止」后已完成单元与剩余分段都留着，再点生成从这里接着跑
        session: null,
        // 当前分段的流式输出（原文 + 已解析出的完整单元），用于实时展示
        live: '',
        liveUnits: [],
        liveOffset: 0,
        // 每个结果卡片当前翻到第几页（分镜太多，一页只摆 UNITS_PER_PAGE 个）
        unitsPage: {},
        // 单个分镜提交 ComfyUI 用的工作流（下拉框在右侧结果区工具栏）
        comfyWorkflows: [],
        comfyWorkflow: '',
        comfyWorkflowJson: {},
        comfyFields: [],
        comfyParams: {},
        // 分镜任务池的「停止」标记：置上之后不再派新的一批
        comfyStop: false,
        // 对话补分镜：对话记录、待插入的新分镜、本次请求的中断控制器
        chatMessages: [],
        chatDraft: [],
        chatRunning: false,
        chatController: null,
        // 补齐过渡分镜：扫描进度文案与中断控制器
        bridgeRunning: false,
        bridgeNote: '',
        bridgeAbort: null,
        // PenShot 管线（解析 / 分镜 / 校验）：任务 id、片段结果、中断控制器。
        // 只展示，不覆盖人物/场景/分镜数据；随剧本工作区一起存取。
        // 另外把中间过程（7 阶段进度、各阶段产出、已用时、输入指纹）一并存进去：
        // 刷新页面或切走剧本再切回时能原样恢复，也用来判断「输入没变就别重跑」。
        penshot: penshotState(null),
        penshotController: null,
        // 本次 PenShot 运行的起跑时间与最新进度，用于展示「已用时 / 进度 / 预计剩余」
        penshotStartedAt: 0,
        penshotProgress: 0,
        // 第六步：提示词技能选项与技能提取的分镜提示词结果（按剧本各存各的，只追加不进已有分镜）
        shotSkills: [],
        shotSkillId: '',
        shotSkill: shotSkillState(null),
        shotSkillRunning: false,
    };

    // ---------- 通用 ----------
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    let toastTimer = null;
    function toast(message) {
        const box = $('toast');
        box.textContent = message;
        box.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => box.classList.remove('show'), 2000);
    }

    async function copyText(text, button) {
        const value = String(text || '');
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
        } catch (e) {
            const area = document.createElement('textarea');
            area.value = value;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            document.execCommand('copy');
            area.remove();
        }
        if (button) {
            const original = button.textContent;
            button.textContent = tr('script.copied');
            setTimeout(() => { button.textContent = original; }, 1200);
        } else {
            toast(tr('script.copied'));
        }
    }

    function download(filename, content, mime) {
        const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function stamp() {
        const now = new Date();
        const pad = (value) => String(value).padStart(2, '0');
        return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    }

    // ---------- 默认提示词 ----------
    async function loadTemplates(selectId) {
        const response = await fetch('/api/script/templates');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        state.templates = data.templates || [];
        renderTemplateSelect(selectId);
    }

    function renderTemplateOptions() {
        const select = $('templateSelect');
        select.innerHTML = '';
        if (!state.templateId) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = tr('script.templateUnsaved');
            select.appendChild(option);
        }
        [['builtin', tr('script.templateBuiltin')], ['user', tr('script.templateMine')]].forEach(([source, label]) => {
            const items = state.templates.filter((item) => (item.source || 'builtin') === source);
            if (!items.length) return;
            const group = document.createElement('optgroup');
            group.label = label;
            items.forEach((template) => {
                const option = document.createElement('option');
                option.value = template.id;
                option.textContent = template.name;
                group.appendChild(option);
            });
            select.appendChild(group);
        });
        if (state.templateId) select.value = state.templateId;
    }

    function renderTemplateSelect(selectId) {
        const target = (selectId && state.templates.some((item) => item.id === selectId))
            ? selectId
            : (state.templates[0] || {}).id;
        state.templateId = target || '';
        renderTemplateOptions();
        applyTemplateToEditor();
    }

    function currentTemplate() {
        return state.templates.find((item) => item.id === state.templateId) || null;
    }

    function applyTemplateToEditor() {
        const template = currentTemplate();
        state.templateOriginal = template ? template.content : '';
        $('templateText').value = state.templateOriginal;
        $('templateHint').textContent = (template && template.description) ? template.description : tr('script.templateHint');
        $('templateNameInput').value = template ? template.name : '';
    }

    function uploadTemplate(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const content = String(reader.result || '').trim();
            if (!content) {
                toast(tr('script.needTemplateContent'));
                return;
            }
            // 上传的提示词先当作「临时提示词」，由用户决定是否存为常用
            state.templateId = '';
            state.templateOriginal = content;
            renderTemplateOptions();
            $('templateText').value = content;
            $('templateEditor').hidden = false;
            $('toggleTemplateBtn').textContent = tr('script.hideTemplate');
            $('templateNameInput').value = file.name.replace(/\.[^.]+$/, '');
            $('templateHint').textContent = tr('script.templateUploaded');
            toast(tr('script.templateUploaded'));
        };
        reader.onerror = () => toast(tf('script.fileReadFailed', { name: file.name }));
        reader.readAsText(file, 'utf-8');
    }

    async function saveTemplate() {
        const name = $('templateNameInput').value.trim();
        const content = $('templateText').value.trim();
        if (!name) {
            toast(tr('script.needTemplateName'));
            return;
        }
        if (!content) {
            toast(tr('script.needTemplateContent'));
            return;
        }
        try {
            const response = await fetch('/api/script/templates', {
                method: 'POST',
                headers: jsonHeaders,
                body: JSON.stringify({ name, content }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
            state.templates = data.templates || state.templates;
            renderTemplateSelect((data.template || {}).id);
            toast(tr('script.templateSaved'));
        } catch (error) {
            toast(String(error.message || error));
        }
    }

    // ---------- 平台 / 模型 ----------
    async function loadProviders() {
        const response = await fetch('/api/providers');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const all = (data.providers || []).filter((provider) => provider.enabled !== false);
        state.providers = all.filter((provider) => (
            (provider.chat_models || []).length > 0
            && !['codex', 'gemini-cli', 'runninghub'].includes(String(provider.protocol || '').toLowerCase())
        ));
        // 参考图另走文生图平台，与生成提示词的对话平台分开选
        state.imageProviders = all.filter((provider) => (provider.image_models || []).length > 0);
        renderProviders();
        renderImageProviders();
    }

    function renderProviders() {
        const select = $('providerSelect');
        select.innerHTML = '';
        state.providers.forEach((provider) => {
            const option = document.createElement('option');
            option.value = provider.id;
            option.textContent = provider.name || provider.id;
            select.appendChild(option);
        });
        const preferred = state.providers.find((item) => item.id === DEFAULT_PROVIDER_ID)
            || state.providers.find((item) => item.primary)
            || state.providers[0];
        if (preferred) {
            state.providerId = preferred.id;
            select.value = preferred.id;
        }
        renderModels();
    }

    function renderModels() {
        const provider = state.providers.find((item) => item.id === state.providerId);
        const models = (provider && provider.chat_models) || [];
        const labels = (provider && provider.model_names) || {};
        const select = $('modelSelect');
        select.innerHTML = '';
        models.forEach((name) => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = labels[name] || name;
            select.appendChild(option);
        });
        state.model = defaultModel(models);
        if (state.model) select.value = state.model;
        select.disabled = models.length === 0;
    }

    function defaultModel(models) {
        const list = models || [];
        for (const hint of DEFAULT_MODEL_HINTS) {
            const hit = list.find((name) => String(name).toLowerCase().includes(hint));
            if (hit) return hit;
        }
        return list[0] || '';
    }

    // ---------- 剧本 ----------
    function scriptContent() {
        return $('scriptText').value.trim();
    }

    function updateScriptSummary() {
        const text = scriptContent();
        $('scriptSummary').textContent = text ? tf('script.charCount', { n: text.replace(/\s+/g, '').length }) : '';
    }

    function readFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            $('scriptText').value = String(reader.result || '');
            updateScriptSummary();
            saveCastState();
        };
        reader.onerror = () => toast(tf('script.fileReadFailed', { name: file.name }));
        reader.readAsText(file, 'utf-8');
    }

    // ---------- 人物与场景提取 ----------
    async function loadCastTemplates() {
        const response = await fetch('/api/script/cast-templates');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        state.castTemplates = data.templates || [];
        state.castTemplateId = state.castTemplates.length ? state.castTemplates[0].id : '';
        renderCastOptions();
    }

    function renderCastOptions() {
        const select = $('castTemplateSelect');
        select.innerHTML = '';
        state.castTemplates.forEach((item) => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.name;
            option.title = item.description || '';
            select.appendChild(option);
        });
        select.value = state.castTemplateId;
    }

    function currentCastTemplate() {
        return state.castTemplates.find((item) => item.id === state.castTemplateId) || null;
    }

    // ---------- 第六步：用技能从剧本正文里提取分镜提示词 ----------
    // 技能下拉框的选项：项目内 static/system-prompts/script-shot/ 下的 .md，渲染写法与模板下拉一致
    async function loadShotSkills() {
        const response = await fetch('/api/script/shot-skills');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        state.shotSkills = data.skills || [];
        renderShotSkillOptions();
    }

    function renderShotSkillOptions() {
        const select = $('shotSkillSelect');
        if (!select) return;
        select.innerHTML = '';
        state.shotSkills.forEach((item) => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.name;
            option.title = item.description || '';
            select.appendChild(option);
        });
        const wanted = state.shotSkill ? state.shotSkill.skillId : '';
        state.shotSkillId = state.shotSkills.some((item) => item.id === wanted)
            ? wanted
            : ((state.shotSkills[0] || {}).id || '');
        select.value = state.shotSkillId;
    }

    // 请求里要带的素材名字：当前人物 / 场景 / 道具清单里已经提取出来的条目名
    function shotSkillCastNames() {
        const names = [];
        CAST_KINDS.forEach((kind) => {
            (state.castItems[kind] || []).forEach((item) => {
                if (item && item.title) names.push(item.title);
            });
        });
        return names;
    }

    // 卡片里「提取时长上限」输入框的值（秒），非法时回退到存档值 / 默认 60；0 = 提取全部
    function shotDurationLimit() {
        const input = $('shotDurationLimit');
        const value = Number(input && input.value);
        if (isFinite(value) && value >= 0) return Math.round(value);
        const saved = state.shotSkill ? Number(state.shotSkill.durationLimit) : NaN;
        return isFinite(saved) && saved >= 0 ? saved : 60;
    }

    // 切剧本、刷新页面时把技能提取结果换成本剧本的（没有就清空重来）
    function applyShotSkillState(saved) {
        state.shotSkill = shotSkillState(saved);
        if (state.shotSkills.length) {
            const wanted = state.shotSkill.skillId;
            state.shotSkillId = state.shotSkills.some((item) => item.id === wanted)
                ? wanted
                : ((state.shotSkills[0] || {}).id || '');
            const select = $('shotSkillSelect');
            if (select) select.value = state.shotSkillId;
        }
        // 提取时长上限跟着剧本走
        const limitInput = $('shotDurationLimit');
        if (limitInput) limitInput.value = String(state.shotSkill.durationLimit);
        renderShotSkillResult();
    }

    function renderShotSkillResult() {
        const box = $('shotSkillResult');
        if (!box) return;
        const shots = (state.shotSkill && state.shotSkill.shots) || [];
        if (!shots.length) {
            box.innerHTML = '';
            return;
        }
        box.innerHTML = shots.map((shot) => {
            const id = shot.index !== undefined && shot.index !== null ? `S${shot.index}` : '';
            const duration = shot.duration ? `${Math.round(Number(shot.duration) || 0)}秒` : '';
            const scene = shot.scene ? ` · ${shot.scene}` : '';
            const characters = (shot.characters || []).join('、');
            const props = (shot.props || []).join('、');
            const meta = tf('script.shotSkillShotMeta', {
                duration,
                scene,
                characters: characters || tr('script.shotSkillNone'),
                props: props || tr('script.shotSkillNone'),
            });
            return `
                <div class="penshot-fragment">
                    <div class="penshot-fragment-head">
                        <span class="penshot-fragment-id">${esc(id)}</span>
                        <span class="penshot-fragment-meta">${esc(meta)}</span>
                    </div>
                    <pre>${esc(shot.prompt || '')}</pre>
                </div>`;
        }).join('');
    }

    // 点按钮：取剧本正文 → 请求提取 → 列出结果并自动并入分镜列表（只追加，不覆盖）
    async function runShotSkillExtract() {
        if (state.shotSkillRunning) return;
        const script = $('scriptText').value.trim();
        if (!script) {
            toast(tr('script.needText'));
            return;
        }
        if (!state.shotSkillId) {
            toast(tr('script.shotSkillNoSkill'));
            return;
        }
        state.shotSkillRunning = true;
        const btn = $('shotSkillRunBtn');
        btn.disabled = true;
        $('shotSkillStatus').textContent = tr('script.shotSkillRunning');
        try {
            const response = await fetch('/api/script/shot-extract', {
                method: 'POST',
                headers: jsonHeaders,
                body: JSON.stringify({
                    provider: state.providerId,
                    model: state.model,
                    ms_model: state.providerId === 'modelscope' ? state.model : '',
                    script,
                    skill_id: state.shotSkillId,
                    style_id: state.styleId,
                    notes: ($('scriptNotes') || {}).value || '',
                    cast_names: shotSkillCastNames(),
                    duration_limit: shotDurationLimit(),
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
            const shots = Array.isArray(data.shots) ? data.shots : [];
            const skillId = String(data.skill_id || state.shotSkillId);
            state.shotSkill = { skillId, shots, status: 'done', durationLimit: shotDurationLimit(), updatedAt: Date.now() };
            renderShotSkillResult();
            const merged = mergeShotSkillShotsIntoStoryboard(shots, skillId);
            $('shotSkillStatus').textContent = tf('script.shotSkillDone', {
                n: merged, total: shots.length, dur: Math.round(Number(data.extracted_duration) || 0),
            });
            saveStoryboardState();
        } catch (error) {
            $('shotSkillStatus').textContent = tf('script.shotSkillFailed', { detail: String(error.message || error) });
        } finally {
            state.shotSkillRunning = false;
            btn.disabled = false;
        }
    }

    // ---------- 画风（人物/场景/道具与分镜共用一份） ----------
    async function loadCastStyles() {
        const response = await fetch('/api/script/styles');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        state.styles = data.styles || [];
        // 默认第一个（写实电影感）；已经有选择就别覆盖，切剧本时靠它还原
        if (!state.styleId || !state.styles.some((item) => item.id === state.styleId)) {
            state.styleId = state.styles.length ? state.styles[0].id : '';
        }
        renderCastStyleOptions();
        renderPenshotStyleOptions();
    }

    // 画风类别在下拉框里的先后顺序；没列到的（比如「其他」）排在最后
    const STYLE_CATEGORY_ORDER = ['真人实拍', '电影类型片', '动画漫画', '美术画种', '技术材质'];
    const STYLE_CATEGORY_I18N = {
        '真人实拍': 'script.styleCatLive',
        '电影类型片': 'script.styleCatFilm',
        '动画漫画': 'script.styleCatAnimation',
        '美术画种': 'script.styleCatArt',
        '技术材质': 'script.styleCatTech',
        '其他': 'script.styleCatOther',
    };

    // 类别名是画风文件里写的中文，界面切英文时按 i18n 表换算；表里没有就直接用原名
    function styleCategoryLabel(name) {
        const key = String(name || '').trim() || '其他';
        const i18nKey = STYLE_CATEGORY_I18N[key];
        const text = i18nKey ? tr(i18nKey) : '';
        return text && text !== i18nKey ? text : key;
    }

    function styleCategoryRank(name) {
        const index = STYLE_CATEGORY_ORDER.indexOf(String(name || '').trim());
        return index === -1 ? STYLE_CATEGORY_ORDER.length : index;
    }

    // 画风下拉统一渲染：人物/场景/道具那步与 PenShot 那步共用同一套画风，改哪个都会两边同步
    function renderStyleOptions(selectId) {
        const select = $(selectId);
        if (!select) return;
        select.innerHTML = '';
        // 画风多了必须分组，否则三四十项平铺下来很难找
        const groups = new Map();
        state.styles.forEach((item) => {
            const key = String(item.category || '').trim() || '其他';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(item);
        });
        Array.from(groups.keys())
            .sort((a, b) => styleCategoryRank(a) - styleCategoryRank(b))
            .forEach((key) => {
                const box = document.createElement('optgroup');
                box.label = styleCategoryLabel(key);
                groups.get(key).forEach((item) => {
                    const option = document.createElement('option');
                    option.value = item.id;
                    option.textContent = item.name;
                    option.title = item.description || '';
                    box.appendChild(option);
                });
                select.appendChild(box);
            });
        select.value = state.styleId;
    }

    function renderCastStyleOptions() {
        renderStyleOptions('castStyleSelect');
    }

    // PenShot 卡片里的画风下拉：与上面那套画风同源，选它就会带进人物/场景/道具与视频分镜提示词
    function renderPenshotStyleOptions() {
        renderStyleOptions('penshotStyleSelect');
    }

    // 人物 / 场景 / 道具三组，各自两个按钮：重出提示词、重出素材（参考图）
    const CAST_KINDS = ['character', 'scene', 'prop'];
    const CAST_REGEN_PROMPT_BUTTONS = {
        character: 'castRegenPromptCharacterBtn',
        scene: 'castRegenPromptSceneBtn',
        prop: 'castRegenPromptPropBtn',
    };
    const CAST_REGEN_ASSET_BUTTONS = {
        character: 'castRegenAssetCharacterBtn',
        scene: 'castRegenAssetSceneBtn',
        prop: 'castRegenAssetPropBtn',
    };

    // 「检查漏掉的条目」按钮：人物、场景、道具三类都生成过才显示（生成/检查进行中一律藏起来）。
    // 判定用「生成过」而不是「文本框非空」：道具可能本来就没有，用非空判断按钮就永远不出现。
    function castCheckReady() {
        return CAST_KINDS.every((kind) => state.castKinds[kind] === true);
    }

    function syncCastCheckBtn(running) {
        $('castCheckMissingBtn').hidden = running === true || !castCheckReady();
    }

    function setCastRunningUI(running) {
        $('castGenerateBtn').hidden = running;
        $('castPropGenerateBtn').hidden = running;
        // 提示词在重写时，别让人还去点「重出素材」——那时文本框里的内容正在被替换
        Object.values(CAST_REGEN_PROMPT_BUTTONS).forEach((id) => { $(id).hidden = running; });
        Object.values(CAST_REGEN_ASSET_BUTTONS).forEach((id) => { $(id).hidden = running; });
        syncCastCheckBtn(running);
        $('castStopBtn').hidden = !running;
    }

    function handleCastEvent(event) {
        if (event.type === 'cast_start') {
            $('castStatus').textContent = tr('script.castRunning');
        } else if (event.type === 'cast_done') {
            const parts = splitCastMarkdown(event.content || '');
            // 只重出其中一类时，另外两类的提示词与参考图原样留着：
            // 参考图是靠提示词匹配的，重写别的部分会把那些图全冲掉。
            const only = CAST_KINDS.includes(event.kind) ? event.kind : '';
            if (only === 'character') {
                $('castCharacters').value = parts.character || $('castCharacters').value;
            } else if (only === 'scene') {
                $('castScenes').value = parts.scene || $('castScenes').value;
            } else if (only === 'prop') {
                $('castProps').value = parts.prop || $('castProps').value;
            } else {
                setCastText(parts.character, parts.scene, parts.prop);
                // 人物、场景与道具全换了，之前生成的参考图全部作废
                state.castShots = {};
            }
            if (only) {
                Object.keys(state.castShots).forEach((key) => {
                    if (key.startsWith(`${only}:`)) delete state.castShots[key];
                });
                state.castKinds[only] = true;
            } else {
                CAST_KINDS.forEach((kind) => { state.castKinds[kind] = true; });
            }
            $('castStatus').textContent = event.truncated ? tr('script.truncated') : tr('script.castDone');
            syncCastGallery();
            // 这一批人物/场景/道具里，凡是别的剧本已经出过图的同名条目，直接认领过来不再重出
            matchCastLibraryImages().catch(() => {});
            syncGenerateEnabled();
        } else if (event.type === 'cast_error') {
            $('castStatus').textContent = event.detail || tr('script.failed');
        } else if (event.type === 'missing_start') {
            $('castStatus').textContent = tr('script.castCheckRunning');
        } else if (event.type === 'missing_done') {
            // 新条目若在素材库里已有同名图，直接认领过来，不重复出图
            const added = mergeMissingCast(event.content || '');
            if (!added.total) {
                $('castStatus').textContent = tr('script.castCheckNone');
                toast(tr('script.castCheckNone'));
                return;
            }
            // 已经生成好的分镜同步一遍：关联上新素材、<Picture N> 改对、旧成片标记需要重新生成
            const synced = markUnitsForNewRefs(added.entries);
            const summary = tf('script.castCheckAdded', { n: added.total, names: added.names.join('、') });
            const tail = synced ? ` ${tf('script.castCheckSync', { n: synced })}` : '';
            $('castStatus').textContent = event.truncated ? tr('script.truncated') : `${summary}${tail}`;
            toast(`${summary}${tail}`);
            matchCastLibraryImages()
                .catch(() => {})
                .finally(() => { drawMissingCastAssets(added.entries); });
        } else if (event.type === 'missing_error') {
            $('castStatus').textContent = event.detail || tr('script.failed');
        }
    }

    // 「补齐缺失素材」：只给这一组里**还没有参考图**的条目出图，已有的图一张都不动。
    // （提示词改过的旧图会被 castShotOf 判为失效，那几条算「没有图」，照样补出来。）
    function fillMissingCastAssets(kind) {
        runCastKind(kind);
    }

    // ---------- PenShot 管线（解析 / 分镜 / 校验）----------
    // 复用第 4 步已选的 API 平台与模型；结果只在第 5 步展示，不覆盖人物/场景/分镜。
    // 阶段划分对应 PenShot 内部 TaskStage 的真实权重（解析 / 拆分镜头 / 视频分段 /
    // 转换提示词 / 质量审查 / 连续性检查 / 生成输出），比原来「解析-导演-校验」三桶更细，
    // 让用户看清每一步在做什么，而不只是一根总进度条。
    const PENSHOT_PHASES = [
        { key: 'parse', code: 'pars', from: 0, to: 15 },
        { key: 'segment', code: 'segment', from: 15, to: 30 },
        { key: 'split', code: 'split', from: 30, to: 50 },
        { key: 'convert', code: 'convert', from: 50, to: 70 },
        { key: 'audit', code: 'audit', from: 70, to: 85 },
        { key: 'continuity', code: 'continuity', from: 85, to: 95 },
        { key: 'output', code: 'output', from: 95, to: 100 },
    ];
    // PenShot 历史结果最多留几份（前端存，随剧本一起落盘；超出的从尾部裁掉，当前查看的那份永远保留）
    const PENSHOT_HISTORY_MAX = 6;
    const PENSHOT_PHASE_LABEL = {
        parse: 'script.penshotPhaseParse',
        segment: 'script.penshotPhaseSegment',
        split: 'script.penshotPhaseSplit',
        convert: 'script.penshotPhaseConvert',
        audit: 'script.penshotPhaseAudit',
        continuity: 'script.penshotPhaseContinuity',
        output: 'script.penshotPhaseOutput',
    };
    // 每个阶段对应 PenShot 管线里实际负责的 Agent，用于「当前 Agent」展示
    const PENSHOT_PHASE_AGENT = {
        parse: 'script.penshotAgentParse',
        segment: 'script.penshotAgentSegment',
        split: 'script.penshotAgentSplit',
        convert: 'script.penshotAgentConvert',
        audit: 'script.penshotAgentAudit',
        continuity: 'script.penshotAgentContinuity',
        output: 'script.penshotAgentOutput',
    };

    // PenShot 存档（片段结果 + 中间过程）的统一形状。老存档只有 taskId/fragments/metadata/validation，
    // 这里补齐其余字段，缺什么给什么默认值，保证前后都能安全读。
    function penshotState(saved) {
        const data = saved && typeof saved === 'object' ? saved : {};
        return {
            taskId: String(data.taskId || ''),
            fragments: Array.isArray(data.fragments) ? data.fragments : [],
            metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
            validation: data.validation && typeof data.validation === 'object' ? data.validation : {},
            // 中间过程：7 阶段各自的完成度与状态、各阶段产出计数、当前阶段、进度、已用时
            stages: data.stages && typeof data.stages === 'object' ? data.stages : null,
            stageResults: data.stageResults && typeof data.stageResults === 'object' ? data.stageResults : {},
            // 上游各阶段自己的实时明细（名称 / 自身进度 / 状态 / 起止时间），长耗时阶段靠它看进度
            stageProgress: data.stageProgress && typeof data.stageProgress === 'object' ? data.stageProgress : {},
            stageCode: String(data.stageCode || ''),
            stageName: String(data.stageName || ''),
            progress: Number(data.progress) || 0,
            elapsedMs: Number(data.elapsedMs) || 0,
            finishedAt: Number(data.finishedAt) || 0,
            status: String(data.status || ''),
            // 这次结果是哪份输入跑出来的（正文 + 画风 + 平台 + 模型），用来判断能不能直接读缓存
            signature: String(data.signature || ''),
            // 本次新增：PenShot 提取的人物 / 场景 / 道具提示词、镜头拆分、质量校验（只读展示）
            castPrompts: data.castPrompts && typeof data.castPrompts === 'object'
                ? {
                    characters: Array.isArray(data.castPrompts.characters) ? data.castPrompts.characters : [],
                    scenes: Array.isArray(data.castPrompts.scenes) ? data.castPrompts.scenes : [],
                    props: Array.isArray(data.castPrompts.props) ? data.castPrompts.props : [],
                }
                : { characters: [], scenes: [], props: [] },
            shots: Array.isArray(data.shots) ? data.shots : [],
            audit: data.audit && typeof data.audit === 'object' ? data.audit : {},
            // 多份历史结果快照；顶层 fragments / metadata / validation / signature / status 仍代表
            // 「最近一次跑完的结果」，缓存命中判断只依赖顶层这些字段，不受历史切换影响。
            history: Array.isArray(data.history) ? data.history : [],
            currentId: String(data.currentId || ''),
            // 提取时长上限（秒）：按已提取分镜的累计时长停止；0 = 不限，一直提取到全部完成
            durationLimit: Number(data.durationLimit) > 0 ? Number(data.durationLimit) : 0,
            // 新产出的分镜提示词是否自动实时并入分镜列表（默认开）
            autoAdopt: data.autoAdopt !== false,
        };
    }

    // 第六步：技能提取的分镜提示词结果（按剧本各记各的，切剧本跟着走）
    function shotSkillState(saved) {
        const data = saved && typeof saved === 'object' ? saved : {};
        return {
            skillId: String(data.skillId || ''),
            shots: Array.isArray(data.shots) ? data.shots : [],
            status: String(data.status || ''),
            // 提取时长上限（秒）：老数据没存过就回默认 60；0 表示「提取全部」
            durationLimit: data.durationLimit === undefined || data.durationLimit === null
                ? 60 : Math.max(0, Math.round(Number(data.durationLimit) || 0)),
            updatedAt: Number(data.updatedAt) || 0,
        };
    }

    // mm:ss 计时显示
    function fmtClock(ms) {
        const total = Math.max(0, Math.round(Number(ms) / 1000));
        return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    }

    // 由「已用时 ÷ 当前进度」线性外推总耗时，据此估算剩余时间。
    // 进度太小（<4%）或跑得太短（<8s）时外推噪声大，先显示占位；超过 45 分钟视为异常不显示。
    function penshotEtaText() {
        const startedAt = Number(state.penshotStartedAt) || 0;
        const pct = Number(state.penshotProgress) || 0;
        if (!startedAt || pct <= 0 || pct < 4) return '';
        const elapsed = Date.now() - startedAt;
        if (elapsed < 8000) return '';
        const remain = elapsed / (pct / 100) - elapsed;
        if (!isFinite(remain) || remain <= 0 || remain > 45 * 60 * 1000) return '';
        return fmtClock(remain);
    }

    // 「已用时 · 进度 N% · 预计剩余」这条状态行的统一格式；etaText 传 null 表示不显示预计剩余
    // （跑完或从存档恢复历史过程时用）
    function penshotMetaText(elapsedMs, pct, etaText) {
        const percent = Math.round(Number(pct) || 0);
        const parts = [
            tf('script.penshotElapsed', { time: fmtClock(elapsedMs) }),
            tf('script.penshotPct', { pct: percent }),
        ];
        if (etaText !== null && percent < 100) {
            parts.push(etaText ? tf('script.penshotEta', { time: etaText }) : tr('script.penshotEtaUnknown'));
        }
        return parts.join(' · ');
    }

    // 恢复存档用：已用时与进度是存下来的死值，不再实时走表，也不显示预计剩余
    function renderPenshotMetaFrozen(elapsedMs, pct) {
        const box = $('penshotMeta');
        if (!box) return;
        const elapsed = Number(elapsedMs) || 0;
        const percent = Number(pct) || 0;
        box.textContent = (!elapsed && !percent) ? '' : penshotMetaText(elapsed, percent, null);
    }

    function updatePenshotMeta() {
        const box = $('penshotMeta');
        if (!box) return;
        const startedAt = Number(state.penshotStartedAt) || 0;
        if (!startedAt) {
            box.textContent = '';
            return;
        }
        box.textContent = penshotMetaText(Date.now() - startedAt, state.penshotProgress, penshotEtaText());
    }

    let penshotTimer = null;
    function startPenshotTimer() {
        stopPenshotTimer();
        penshotTimer = setInterval(updatePenshotMeta, 1000);
        updatePenshotMeta();
    }

    function stopPenshotTimer() {
        if (penshotTimer) {
            clearInterval(penshotTimer);
            penshotTimer = null;
        }
    }

    // 当前阶段 code 属于哪一段，就返回对应的 Agent 名
    function penshotAgentLabel(stageCode) {
        const code = String(stageCode || '');
        const phase = PENSHOT_PHASES.find((item) => code.startsWith(item.code));
        return phase ? tr(PENSHOT_PHASE_AGENT[phase.key]) : '';
    }

    // 阶段行按需渲染（空容器里生成七行），后续只更新各自状态与进度
    function ensurePenshotStageRows() {
        const box = $('penshotStages');
        if (!box || box.querySelector('.penshot-stage')) return box;
        box.innerHTML = PENSHOT_PHASES.map((phase) => `
            <div class="penshot-stage" data-stage="${phase.key}" data-state="pending">
                <span class="penshot-stage-name">${esc(tr(PENSHOT_PHASE_LABEL[phase.key]))}</span>
                <span class="penshot-stage-bar"><span class="penshot-stage-fill" data-penshot-fill="${phase.key}"></span></span>
                <span class="penshot-stage-pct" data-penshot-pct="${phase.key}">0%</span>
            </div>`).join('');
        return box;
    }

    function penshotStageEl(key) {
        return document.querySelector(`#penshotStages .penshot-stage[data-stage="${key}"]`);
    }

    function setPenshotStage(key, pct, stageState) {
        const el = penshotStageEl(key);
        if (!el) return;
        el.dataset.state = stageState || 'active';
        const value = Math.max(0, Math.min(100, Math.round(pct)));
        const fill = el.querySelector(`[data-penshot-fill="${key}"]`);
        const label = el.querySelector(`[data-penshot-pct="${key}"]`);
        if (fill) fill.style.width = `${value}%`;
        if (label) label.textContent = `${value}%`;
    }

    // 各阶段完成时上游回传的产出计数（stage_results[阶段code]）→ 一行可读摘要
    const PENSHOT_RESULT_NOTE = {
        parse: { code: 'parsing_complete', label: 'script.penshotPhaseParse',
            build: (r) => tf('script.penshotNoteParse', { scene: r.scene_count || 0, character: r.character_count || 0 }) },
        segment: { code: 'segment_complete', label: 'script.penshotPhaseSegment',
            build: (r) => tf('script.penshotNoteSegment', { shots: r.shot_count || 0 }) },
        split: { code: 'split_complete', label: 'script.penshotPhaseSplit',
            build: (r) => tf('script.penshotNoteSplit', { frags: r.fragment_count || 0, dur: Math.round(r.total_duration || 0) }) },
        convert: { code: 'convert_complete', label: 'script.penshotPhaseConvert',
            build: (r) => tf('script.penshotNoteConvert', { prompts: r.prompt_count || 0 }) },
        audit: { code: 'audit_complete', label: 'script.penshotPhaseAudit',
            build: (r) => tf('script.penshotNoteAudit', { score: r.score != null ? r.score : 0, issues: r.violations_count || 0 }) },
        continuity: { code: 'continuity_complete', label: 'script.penshotPhaseContinuity',
            build: (r) => (r.passed ? tr('script.penshotNoteContinuityPass') : tf('script.penshotNoteContinuityFail', { issues: r.total_issues || 0 })) },
    };

    // 把已完成阶段的产出列成「阶段：计数」清单，让用户看清每一步实际产出多少
    function renderPenshotStats(stageResults) {
        const box = $('penshotStats');
        if (!box) return;
        const results = stageResults && typeof stageResults === 'object' ? stageResults : {};
        const lines = [];
        Object.keys(PENSHOT_RESULT_NOTE).forEach((phaseKey) => {
            const meta = PENSHOT_RESULT_NOTE[phaseKey];
            const data = results[meta.code];
            if (!data || typeof data !== 'object') return;
            let text = '';
            try { text = meta.build(data) || ''; } catch (error) { text = ''; }
            if (!text) return;
            lines.push(`<div class="penshot-stat"><b>${esc(tr(meta.label))}</b>：${esc(text)}</div>`);
        });
        box.innerHTML = lines.join('');
    }

    // 「当前 Agent（当前阶段）」那一行；给不出内容就整行藏起来
    function setPenshotCurrent(stageCode, stageName) {
        const cur = $('penshotCurrent');
        if (!cur) return;
        const agent = penshotAgentLabel(stageCode);
        const name = String(stageName || '').trim();
        let text = '';
        if (agent && name) text = tf('script.penshotAgentNow', { agent, name });
        else if (agent) text = tf('script.penshotAgentOnly', { agent });
        else if (name) text = tf('script.penshotCurrent', { name });
        cur.hidden = !text;
        cur.textContent = text;
    }

    // 上游各阶段的实时明细：只列「已完成的」+「当前正在跑的那一个」。
    // 上游会为每一步写一批瞬时项（「开始X」「X中」「X完成」），全列出来又长又会同时显示好几个"进行中"；
    // 总进度是加权来的、单个阶段跑很久时几乎不动，靠这一列才看得出卡在哪一步、跑了多久。
    function renderPenshotUpstream(stagesProgress) {
        const box = $('penshotUpstream');
        if (!box) return;
        const stages = stagesProgress && typeof stagesProgress === 'object' ? stagesProgress : {};
        const keys = Object.keys(stages);
        let activeKey = '';
        keys.forEach((key) => {
            const info = stages[key];
            if (info && typeof info === 'object' && String(info.status || '') === 'processing') {
                activeKey = key;   // 取最后一个仍在 processing 的（上游按时间顺序写入）
            }
        });
        const rows = keys.filter((key) => {
            const info = stages[key];
            if (!info || typeof info !== 'object') return false;
            return String(info.status || '') === 'completed' || key === activeKey;
        }).map((key) => {
            const info = stages[key];
            const name = String(info.name || key);
            const done = String(info.status || '') === 'completed';
            const pct = done ? 100 : Math.max(0, Math.min(100, Math.round(Number(info.progress) || 0)));
            const startedMs = info.started_at ? Date.parse(info.started_at) : 0;
            const endMs = done && info.completed_at ? Date.parse(info.completed_at) : Date.now();
            const span = startedMs ? fmtClock(endMs - startedMs) : '';
            let detail = '';
            if (info.details && typeof info.details === 'object') {
                detail = Object.keys(info.details)
                    .map((k) => `${k}=${info.details[k]}`)
                    .join(' ')
                    .slice(0, 160);
            }
            return `<div class="penshot-upstream-row" data-state="${done ? 'done' : 'active'}">
                <span class="penshot-upstream-name">${done ? '✓' : '…'} ${esc(name)}</span>
                <span class="penshot-stage-bar"><span class="penshot-stage-fill" style="width:${pct}%"></span></span>
                <span class="penshot-upstream-pct">${pct}%${span ? ` · ${esc(span)}` : ''}</span>
            </div>${detail ? `<div class="penshot-upstream-detail">${esc(detail)}</div>` : ''}`;
        }).join('');
        if (!rows) {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        box.hidden = false;
        box.innerHTML = `<div class="muted" style="font-size:11.5px;margin-bottom:4px">${esc(tr('script.penshotUpstream'))}</div>${rows}`;
    }

    // 上游给「总进度 + 当前子阶段 code/名 + 各阶段产出」：按各阶段权重区间折算每段进度，
    // 当前子阶段 code 前缀命中哪一段就高亮哪一段，并显示「当前阶段」与已完成阶段的产出。
    // 同时把这一段过程记进 state.penshot.stages，供刷新 / 切剧本后原样恢复。
    function renderPenshotProgress(progress, stageCode, stageName, stageResults, stagesProgress) {
        const total = Math.max(0, Math.min(100, Number(progress) || 0));
        const code = String(stageCode || '');
        ensurePenshotStageRows();
        const snapshot = {};
        PENSHOT_PHASES.forEach((phase) => {
            const hit = code.startsWith(phase.code);
            let pct = 0;
            let stageState = 'pending';
            if (total >= phase.to) {
                pct = 100;
                stageState = 'done';
            } else if (hit || total > phase.from) {
                const within = Math.min(total, phase.to);
                pct = ((within - phase.from) / (phase.to - phase.from)) * 100;
                stageState = 'active';
            }
            setPenshotStage(phase.key, pct, stageState);
            snapshot[phase.key] = { pct: Math.round(pct), state: stageState };
        });
        state.penshot.stages = snapshot;
        if (stagesProgress && typeof stagesProgress === 'object') {
            state.penshot.stageProgress = stagesProgress;
        }
        setPenshotCurrent(code, stageName);
        renderPenshotUpstream(state.penshot.stageProgress);
        renderPenshotStats(stageResults);
    }

    // 用存档里的过程快照把 7 行阶段条与「当前 Agent」原样画回来（不重新计算，照存照画）
    function restorePenshotStages(stages, stageCode, stageName, stageResults, stageProgress) {
        ensurePenshotStageRows();
        PENSHOT_PHASES.forEach((phase) => {
            const saved = stages && stages[phase.key];
            if (saved && typeof saved === 'object') {
                setPenshotStage(phase.key, Number(saved.pct) || 0, saved.state || 'pending');
            } else {
                setPenshotStage(phase.key, 0, 'pending');
            }
        });
        setPenshotCurrent(stageCode, stageName);
        renderPenshotUpstream(stageProgress);
        renderPenshotStats(stageResults);
    }

    function resetPenshotStages() {
        ensurePenshotStageRows();
        PENSHOT_PHASES.forEach((phase) => setPenshotStage(phase.key, 0, 'pending'));
        const cur = $('penshotCurrent');
        if (cur) {
            cur.hidden = true;
            cur.textContent = '';
        }
        renderPenshotUpstream({});
        renderPenshotStats({});
    }

    function clearPenshotRun() {
        stopPenshotTimer();
        state.penshotStartedAt = 0;
        state.penshotProgress = 0;
        const meta = $('penshotMeta');
        if (meta) meta.textContent = '';
    }

    // ---------- PenShot 中间过程的存档与复用 ----------
    // 过程快照在运行时变动频繁，落盘节流到 1.5 秒一次；跑完那一刻再强制刷一次
    let penshotPersistTimer = null;

    function persistPenshotRun() {
        // 结果与中间过程一起随剧本工作区落盘（浏览器本地 + 本机剧本文件），刷新 / 切剧本后可恢复
        try {
            saveStoryboardState();
        } catch (error) { /* 配额或隐私模式下静默跳过 */ }
    }

    function schedulePenshotPersist() {
        if (penshotPersistTimer) return;
        penshotPersistTimer = setTimeout(() => {
            penshotPersistTimer = null;
            persistPenshotRun();
        }, 1500);
    }

    // immediate=true 用于「跑完这一刻」：等 1.5 秒防抖再落盘的话，
    // 用户看到「已生成」就刷新页面，本机文件里那份还没写上去，缓存就命中不了了
    function flushPenshotPersist(immediate) {
        if (penshotPersistTimer) {
            clearTimeout(penshotPersistTimer);
            penshotPersistTimer = null;
        }
        persistPenshotRun();
        if (immediate) flushScriptProject({ force: true });
    }

    // 这次结果对应的输入指纹：正文 + 画风。这两项都随剧本存下来，刷新 / 切剧本后取回还是同一个值。
    // 故意不含平台 / 模型——它们不随剧本存，每次打开页面 renderProviders() 都会重置回默认平台，
    // 带进指纹里会让刷新后必然「不匹配」，缓存永远命中不了。想换平台 / 模型重跑，直接点「重新运行」。
    function penshotSignature() {
        return [
            textHash($('scriptText').value.trim()),
            String(state.styleId || ''),
        ].join('|');
    }

    // 输入没变、且上次是一次完整跑完的结果 → 直接读缓存，不用再调 PenShot
    function penshotCacheHit() {
        const saved = state.penshot || {};
        if (saved.status !== 'done') return false;
        if (!saved.signature || saved.signature !== penshotSignature()) return false;
        return Array.isArray(saved.fragments) && saved.fragments.length > 0;
    }

    // 有存档结果时把「重新运行」按钮露出来（它永远强制重跑，与「生成」的读缓存行为互补）
    function syncPenshotRerunUI() {
        const btn = $('penshotRerunBtn');
        if (!btn) return;
        btn.hidden = !(state.penshot && Array.isArray(state.penshot.fragments) && state.penshot.fragments.length);
    }

    // 缓存命中：把上次的中间过程与结果原样画回来，不发起任何 PenShot 运行
    function restorePenshotFromCache() {
        const saved = state.penshot;
        state.penshotProgress = Number(saved.progress) || 100;
        stopPenshotTimer();
        state.penshotStartedAt = 0;
        $('penshotStages').hidden = false;
        restorePenshotStages(saved.stages, saved.stageCode, saved.stageName, saved.stageResults, saved.stageProgress);
        renderPenshotMetaFrozen(saved.elapsedMs, state.penshotProgress);
        renderPenshotResult();
        $('penshotStatus').textContent = tf('script.penshotCacheLoaded', { n: saved.fragments.length });
        setPenshotRunningUI(false);
    }

    // ---------- PenShot 结果的多份快照（历史）------ ----------
    // 每跑完一次就把结果封成一份快照存进 history，切换 chip 就切 currentId 看哪一份。
    const PENSHOT_CAST_GROUPS = [
        { kind: 'character', key: 'characters', label: 'script.penshotKindCharacter' },
        { kind: 'scene', key: 'scenes', label: 'script.penshotKindScene' },
        { kind: 'prop', key: 'props', label: 'script.penshotKindProp' },
    ];
    const PENSHOT_CAST_GROUP_BY_KIND = {
        character: PENSHOT_CAST_GROUPS[0],
        scene: PENSHOT_CAST_GROUPS[1],
        prop: PENSHOT_CAST_GROUPS[2],
    };
    let penshotSnapshotSeq = 0;

    function penshotSnapshotId() {
        penshotSnapshotSeq += 1;
        return `ps-${Date.now().toString(36)}-${penshotSnapshotSeq}`;
    }

    // 当前查看的那份历史快照；没有历史（老存档）时回退到顶层结果，都没有就 null
    function currentPenshotSnapshot() {
        const history = (state.penshot && state.penshot.history) || [];
        if (!history.length) return null;
        const currentId = String((state.penshot && state.penshot.currentId) || '');
        return history.find((snap) => snap && snap.id === currentId) || history[0] || null;
    }

    // 把一份结果封成快照插到历史最前面并置为当前查看的那份。
    // 不传 view 就是「最近一次跑完的结果」；传 view 用于派生快照。
    function pushPenshotSnapshot(view) {
        const saved = state.penshot;
        if (!saved) return null;
        if (!Array.isArray(saved.history)) saved.history = [];
        const src = view || saved;
        const snapshot = {
            id: penshotSnapshotId(),
            createdAt: Number(src.createdAt) || Number(saved.finishedAt) || Date.now(),
            taskId: String(src.taskId || saved.taskId || ''),
            signature: String(src.signature || saved.signature || ''),
            fragments: Array.isArray(src.fragments) ? src.fragments : [],
            metadata: src.metadata && typeof src.metadata === 'object' ? src.metadata : (saved.metadata || {}),
            validation: src.validation && typeof src.validation === 'object' ? src.validation : (saved.validation || {}),
            castPrompts: src.castPrompts || saved.castPrompts || { characters: [], scenes: [], props: [] },
            shots: Array.isArray(src.shots) ? src.shots : (saved.shots || []),
            audit: src.audit && typeof src.audit === 'object' ? src.audit : (saved.audit || {}),
            adopted: { cast: {}, fragments: {} },
        };
        saved.history.unshift(snapshot);
        saved.currentId = snapshot.id;
        // 超上限从尾部裁；新建的这份总在最前面，不会被裁掉
        while (saved.history.length > PENSHOT_HISTORY_MAX) saved.history.pop();
        return snapshot;
    }

    function selectPenshotSnapshot(id) {
        const history = (state.penshot && state.penshot.history) || [];
        if (!history.some((snap) => snap && snap.id === id)) return;
        state.penshot.currentId = id;
        renderPenshotResult();
        flushPenshotPersist(true);
    }

    function deletePenshotSnapshot(id) {
        const saved = state.penshot || {};
        const history = Array.isArray(saved.history) ? saved.history : [];
        const index = history.findIndex((snap) => snap && snap.id === id);
        if (index < 0) return;
        history.splice(index, 1);
        if (saved.currentId === id) saved.currentId = (history[0] && history[0].id) || '';
        renderPenshotResult();
        toast(tr('script.penshotHistoryDeleted'));
        flushPenshotPersist(true);
    }

    function fmtHm(ts) {
        const date = new Date(Number(ts) || Date.now());
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    // 开跑前清掉只读展示区（提示词 / 校验 / 历史条），等跑完再统一画
    function clearPenshotResultViews() {
        ['penshotHistoryBar', 'penshotCastPrompts', 'penshotAudit'].forEach((id) => {
            const box = $(id);
            if (box) {
                box.hidden = true;
                box.innerHTML = '';
            }
        });
    }

    // 统一重画入口：快照条 + 人物/场景/道具提示词 + 质量校验 + 片段列表
    function renderPenshotResult() {
        const view = currentPenshotSnapshot() || state.penshot || {};
        renderPenshotHistoryBar();
        renderPenshotCastPrompts(view);
        renderPenshotAudit(view);
        renderPenshotFragments(view);
        syncPenshotAdoptUI();
    }

    function renderPenshotHistoryBar() {
        const box = $('penshotHistoryBar');
        if (!box) return;
        const history = (state.penshot && state.penshot.history) || [];
        if (history.length < 2) {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        box.hidden = false;
        const currentId = String((state.penshot && state.penshot.currentId) || '');
        const chips = history.map((snap) => {
            const label = tf('script.penshotHistoryItem', { time: fmtHm(snap.createdAt), n: (snap.fragments || []).length });
            const adoptedCount = Object.keys((snap.adopted && snap.adopted.cast) || {}).length
                + Object.keys((snap.adopted && snap.adopted.fragments) || {}).length;
            const adopted = adoptedCount ? ` · ${tf('script.penshotAdoptedCount', { n: adoptedCount })}` : '';
            const current = snap.id === currentId ? ' data-current="1"' : '';
            const id = esc(snap.id);
            return `<span class="penshot-history-item">
                <button class="penshot-history-chip"${current} data-action="penshot-history-pick" data-id="${id}" title="${esc(tr('script.penshotHistoryPick'))}">${esc(label)}${esc(adopted)}</button>
                <button class="btn-mini" data-action="penshot-delete-snapshot" data-id="${id}" title="${esc(tr('script.penshotHistoryDelete'))}">${esc(tr('script.penshotHistoryDelete'))}</button>
            </span>`;
        }).join('');
        box.innerHTML = `<div class="penshot-history"><span class="muted" style="font-size:11.5px">${esc(tr('script.penshotHistory'))}</span>${chips}</div>`;
    }

    // 卡片里「提取时长上限」输入框的值（秒），非法时回退到存档值；0 = 不限
    function penshotDurationLimit() {
        const input = $('penshotDurationLimit');
        const value = Number(input && input.value);
        if (isFinite(value) && value >= 0) return Math.round(value);
        const saved = Number((state.penshot && state.penshot.durationLimit) || 0);
        return saved > 0 ? Math.round(saved) : 0;
    }

    // 新产出的分镜提示词是否自动实时并入分镜列表
    function penshotAutoAdopt() {
        const input = $('penshotAutoAdopt');
        if (input) return Boolean(input.checked);
        return !(state.penshot && state.penshot.autoAdopt === false);
    }

    // 把新产出的分镜提示词并入分镜列表（按片段 id 去重；已存在但内容变了的就地更新提示词与关联素材）。
    // 用于「等待上限到点 / 运行中」自动把已产出的片段实时落到分镜里，已有分镜不动。
    function mergePenshotFragmentsIntoStoryboard(fragments) {
        const list = (fragments || []).filter((frag) => frag && frag.fragment_id);
        if (!list.length) return 0;
        let result = state.results[0];
        if (!result) {
            result = { index: 0, title: tr('script.title'), status: 'done', units: [], raw: '' };
            state.results[0] = result;
        }
        const units = result.units || (result.units = []);
        const used = new Set(units.map((unit) => String(unit.code || '').toUpperCase()));
        const byRef = new Map();
        units.forEach((unit) => {
            if (unit && unit.penshotRef) byRef.set(String(unit.penshotRef), unit);
        });
        let num = 1;
        let added = 0;
        let updated = 0;
        list.forEach((fragment) => {
            const refNames = penshotFragmentRefNames(fragment);
            const header = penshotRefHeader(refNames);
            // 参考声明一律由本项目按素材清单重建：模型自己写的那排 <Subject…> 丢掉，
            // 不然它的编号跟实际接进工作流的参考图对不上（写错就会让工作流报「未连接」）。
            const prompt = header + stripUnitSubjectHeader(fragment.prompt);
            const duration = `${Math.round(Number(fragment.duration) || 0)}秒`;
            const name = String(fragment.main_character || (fragment.characters && fragment.characters[0]) || '');
            const ref = String(fragment.fragment_id);
            const existing = byRef.get(ref);
            if (existing) {
                if (existing.prompt !== prompt || JSON.stringify(existing.refNames || []) !== JSON.stringify(refNames)) {
                    existing.prompt = prompt;
                    existing.raw = prompt;
                    existing.duration = duration;
                    existing.name = name;
                    existing.refNames = refNames;
                    existing.penshotExtra = {
                        negative_prompt: fragment.negative_prompt || '',
                        audio: fragment.audio || null,
                    };
                    updated += 1;
                }
                return;
            }
            while (used.has(`F${String(num).padStart(2, '0')}`)) num += 1;
            const code = `F${String(num).padStart(2, '0')}`;   // F 前缀，避免与 P## / P##A 撞码
            used.add(code);
            num += 1;
            const unit = {
                code,
                duration,
                name,
                prompt,
                raw: prompt,
                penshotRef: ref,
                penshotExtra: { negative_prompt: fragment.negative_prompt || '', audio: fragment.audio || null },
                refNames,
            };
            units.push(unit);
            byRef.set(ref, unit);
            added += 1;
        });
        if (!added && !updated) return 0;
        result.status = 'done';
        state.unitsPage = {};
        renderResults();
        return added + updated;
    }

    // 把技能提取出来的分镜提示词并入分镜列表：只追加，按「技能 id + 序号」去重；
    // 同 ref 的条目（本功能自己产生的那条）已存在就地更新提示词与关联名，别的分镜一个字都不动。
    function mergeShotSkillShotsIntoStoryboard(shots, skillId) {
        const list = (shots || []).filter((shot) => shot && shot.index !== undefined && shot.index !== null);
        if (!list.length) return 0;
        let result = state.results[0];
        if (!result) {
            result = { index: 0, title: tr('script.title'), status: 'done', units: [], raw: '' };
            state.results[0] = result;
        }
        const units = result.units || (result.units = []);
        const used = new Set(units.map((unit) => String(unit.code || '').toUpperCase()));
        const byRef = new Map();
        units.forEach((unit) => {
            if (unit && unit.shotSkillRef) byRef.set(String(unit.shotSkillRef), unit);
        });
        let num = 1;
        let added = 0;
        let updated = 0;
        list.forEach((shot) => {
            const ref = `${String(skillId || '')}#${shot.index}`;
            const refNames = [];
            (shot.characters || []).forEach((name) => refNames.push({ kind: 'character', name: String(name) }));
            if (shot.scene) refNames.push({ kind: 'scene', name: String(shot.scene) });
            const header = penshotRefHeader(refNames);
            // 同上：模型写的那排 <Subject…> 丢掉，只留本项目按实际引用重建的一份。
            const prompt = header + stripUnitSubjectHeader(shot.prompt);
            const duration = shot.duration ? `${Math.round(Number(shot.duration) || 0)}秒` : '';
            const name = String(shot.scene || (shot.characters && shot.characters[0]) || '');
            const existing = byRef.get(ref);
            if (existing) {
                if (existing.prompt !== prompt || JSON.stringify(existing.refNames || []) !== JSON.stringify(refNames)) {
                    existing.prompt = prompt;
                    existing.raw = prompt;
                    existing.duration = duration;
                    existing.name = name;
                    existing.refNames = refNames;
                    updated += 1;
                }
                return;
            }
            while (used.has(`S${String(num).padStart(2, '0')}`)) num += 1;
            const code = `S${String(num).padStart(2, '0')}`;   // S 前缀，避免与 P## / F## 撞码
            used.add(code);
            num += 1;
            const unit = {
                code,
                duration,
                name,
                prompt,
                raw: prompt,
                shotSkillRef: ref,
                refNames,
            };
            units.push(unit);
            byRef.set(ref, unit);
            added += 1;
        });
        if (!added && !updated) return 0;
        result.status = 'done';
        state.unitsPage = {};
        renderResults();
        return added + updated;
    }

    // 自动实时并入：开关打开、且当前没有别的任务在跑时才并入
    function autoAdoptPenshotFragments(fragments) {
        if (!penshotAutoAdopt()) return 0;
        if (penshotAdoptBusy()) return 0;
        return mergePenshotFragmentsIntoStoryboard(fragments);
    }

    // 一条人物/场景/道具提示词在「已采用」标记里的键（kind + 名字键）
    function penshotCastKey(kind, name, spec) {
        const title = castItemTitle(`${name} · ${spec}`);
        return `${kind}:${castNameKeys(title)[0] || name}`;
    }

    function renderPenshotCastPrompts(view) {
        const box = $('penshotCastPrompts');
        if (!box) return;
        const groups = PENSHOT_CAST_GROUPS.map((group) => {
            const items = ((view.castPrompts || {})[group.key]) || [];
            if (!items.length) return '';
            const rows = items.map((item) => {
                const spec = item.spec ? ` · ${esc(item.spec)}` : '';
                const key = esc(penshotCastKey(group.kind, item.name, item.spec));
                return `<div class="penshot-cast-item">
                    <div class="penshot-cast-group-head">
                        <span class="penshot-fragment-id">${esc(item.name)}${spec}</span>
                        <button class="btn-mini" data-action="penshot-adopt-cast" data-kind="${group.kind}" data-key="${key}" data-name="${esc(item.name)}">${esc(tr('script.penshotCastAdopt'))}</button>
                    </div>
                    <pre>${esc(item.prompt || '')}</pre>
                </div>`;
            }).join('');
            return `<div class="penshot-cast-group">
                <div class="penshot-cast-group-head">
                    <span class="penshot-cast-group-name">${esc(tr(group.label))} · ${items.length}</span>
                    <button class="btn-mini" data-action="penshot-adopt-all-cast" data-kind="${group.kind}">${esc(tr('script.penshotCastAdoptAll'))}</button>
                </div>
                ${rows}
            </div>`;
        }).filter(Boolean).join('');
        if (!groups) {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        box.hidden = false;
        box.innerHTML = `<div class="muted" style="font-size:11.5px;margin-bottom:6px">${esc(tr('script.penshotCastTitle'))}</div>${groups}`;
    }

    function renderPenshotAudit(view) {
        const box = $('penshotAudit');
        if (!box) return;
        const audit = view.audit || {};
        const checks = Array.isArray(audit.checks) ? audit.checks : [];
        const suggestions = Array.isArray(audit.suggestions) ? audit.suggestions : [];
        if (!checks.length && !audit.status && !suggestions.length) {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        box.hidden = false;
        const raw = String(audit.status || '').trim();
        const pass = !raw || /pass|ok|success|通过/i.test(raw);
        const stats = audit.stats || {};
        const rate = Number(stats.pass_rate);
        const head = [
            pass ? tr('script.penshotAuditPass') : raw,
            isFinite(rate) ? tf('script.penshotAuditRate', { pct: Math.round(rate * 100) }) : '',
            audit.violations ? tf('script.penshotAuditIssues', { n: audit.violations }) : '',
        ].filter(Boolean).map((part) => esc(part)).join(' · ');
        const checksHtml = checks.map((check) => {
            const ok = String(check.status || '').toLowerCase() === 'passed';
            return `<div class="penshot-audit-check"><b>${ok ? '✓' : '!'} ${esc(check.name || '')}</b>${check.details ? `：${esc(check.details)}` : ''}</div>`;
        }).join('');
        const suggestHtml = suggestions.map((text) => `<div class="penshot-audit-check">${esc(tf('script.penshotAuditSuggest', { text }))}</div>`).join('');
        box.innerHTML = `<div class="muted" style="font-size:11.5px;margin-bottom:6px">${esc(tr('script.penshotAuditTitle'))}</div>
            <div class="muted" style="font-size:11.5px;margin-bottom:6px">${head}</div>
            ${checksHtml}
            ${suggestHtml}`;
    }

    // 片段列表（原 renderPenshotResult 的卡片结构）+ 每个片段的「采用到分镜」+ 末尾镜头拆分
    function renderPenshotFragments(view) {
        const box = $('penshotResult');
        if (!box) return;
        const fragments = view.fragments || [];
        const cards = fragments.map((item, index) => {
            const id = esc(item.fragment_id || `fragment-${index + 1}`);
            const duration = item.duration != null ? tf('script.penshotDuration', { n: item.duration }) : '';
            const meta = [duration, item.model, item.style].filter(Boolean).map((part) => esc(part)).join(' · ');
            const flag = item.requires_special_attention
                ? `<span class="penshot-flag">${esc(tr('script.penshotFlag'))}</span>` : '';
            const adopt = `<button class="btn-mini" data-action="penshot-adopt-fragment" data-id="${id}">${esc(tr('script.penshotFragmentAdopt'))}</button>`;
            const negative = item.negative_prompt
                ? `<pre class="neg">${esc(tr('script.penshotNeg'))}: ${esc(item.negative_prompt)}</pre>` : '';
            // PenShot 的音频是嵌套对象（audio.prompt），不是顶层 audio_prompt
            const audioPrompt = item.audio && item.audio.prompt ? String(item.audio.prompt) : '';
            const audio = audioPrompt
                ? `<pre class="neg">${esc(tr('script.penshotAudio'))}: ${esc(audioPrompt)}</pre>` : '';
            return `
                <div class="penshot-fragment">
                    <div class="penshot-fragment-head">
                        <span class="penshot-fragment-id">${id}</span>
                        <span class="penshot-fragment-actions"><span class="penshot-fragment-meta">${meta} ${flag}</span>${adopt}</span>
                    </div>
                    <pre>${esc(item.prompt || '')}</pre>
                    ${negative}
                    ${audio}
                </div>`;
        }).join('');
        const allBtn = fragments.length >= 2
            ? `<div class="row" style="margin-top:6px"><button class="btn-mini" data-action="penshot-adopt-all-fragment">${esc(tr('script.penshotFragmentAdoptAll'))}</button></div>`
            : '';
        box.innerHTML = `${cards}${allBtn}${renderPenshotShots(view)}`;
    }

    // 镜头拆分（折叠展示，不单独开容器）
    function renderPenshotShots(view) {
        const shots = view.shots || [];
        if (!shots.length) return '';
        const rows = shots.map((shot) => {
            const meta = tf('script.penshotShotMeta', { type: shot.shot_type || '', n: shot.duration != null ? shot.duration : '' });
            const who = shot.main_character ? ` · ${esc(shot.main_character)}` : '';
            return `<div class="penshot-audit-check"><b>${esc(shot.id || '')}</b> · ${esc(meta)}${who}：${esc(shot.description || '')}</div>`;
        }).join('');
        return `<details style="margin-top:8px"><summary class="muted" style="font-size:11.5px">${esc(tr('script.penshotShots'))} (${shots.length})</summary>${rows}</details>`;
    }

    // 依据当前快照的 adopted 标记，把已采用的按钮置为「已采用」并禁用
    function syncPenshotAdoptUI() {
        const card = $('penshotCard');
        if (!card) return;
        const snapshot = currentPenshotSnapshot();
        const adopted = (snapshot && snapshot.adopted) || {};
        const cast = adopted.cast || {};
        const frags = adopted.fragments || {};
        card.querySelectorAll('button[data-action="penshot-adopt-cast"]').forEach((btn) => {
            if (cast[btn.dataset.key || '']) {
                btn.disabled = true;
                btn.classList.add('penshot-adopted');
                btn.textContent = tr('script.penshotCastAdopted');
            }
        });
        card.querySelectorAll('button[data-action="penshot-adopt-fragment"]').forEach((btn) => {
            if (frags[btn.dataset.id || '']) {
                btn.disabled = true;
                btn.classList.add('penshot-adopted');
                btn.textContent = tr('script.penshotCastAdopted');
            }
        });
    }

    // ---------- 采用（只追加、不覆盖、不重排）----------
    function penshotAdoptBusy() {
        return Boolean(state.castRunning || state.running);
    }

    // PenShot 片段带的场景 / 人物 → 清单里真实存在的条目引用（清单里没有的就不绑，免得引用到不存在的素材）
    function penshotFragmentRefNames(fragment) {
        const names = [];
        (fragment.characters || []).forEach((name) => names.push({ kind: 'character', name: String(name) }));
        (fragment.scenes || []).forEach((name) => names.push({ kind: 'scene', name: String(name) }));
        return names.filter(({ kind, name }) => castEntriesMatchingName(kind, name).length);
    }

    // 把「这个片段用到哪几张参考图」按现有分镜的写法写进片段提示词，出视频时才会把场景图 / 人物图当真参考：
    // 人物走 <Subject i>名是<Picture i>…，场景走 <Subject j>是场景名场景。；编号按参考图接进工作流的顺序（人物在前）。
    function penshotRefHeader(refNames) {
        // 只给「已经出好图」的素材写编号：没图的写 <Picture N> 只会让工作流报「未连接」而失败
        const refs = unitCastRefItems({ refNames, prompt: '', raw: '' });
        if (!refs.length) return '';
        const chars = refs.filter(({ item }) => item.kind === 'character');
        const scenes = refs.filter(({ item }) => item.kind === 'scene');
        const lines = [];
        chars.forEach(({ item }, index) => {
            lines.push(`<Subject ${index + 1}>${item.title}是<Picture ${index + 1}>保留参考图中的面部特征、发型、服装、身材比例与整体外貌。`);
        });
        scenes.forEach(({ item }, index) => {
            lines.push(`<Subject ${chars.length + index + 1}>是${item.title}场景。`);
        });
        return lines.length ? `${lines.join('\n')}\n\n` : '';
    }

    function adoptPenshotCast(kind, name) {
        if (penshotAdoptBusy()) { toast(tr('script.penshotAdoptBusy')); return; }
        const snapshot = currentPenshotSnapshot();
        if (!snapshot) return;
        const group = PENSHOT_CAST_GROUP_BY_KIND[kind];
        if (!group) return;
        const items = ((snapshot.castPrompts || {})[group.key] || []).filter((item) => item && item.name === name);
        adoptCastItems(kind, items);
    }

    function adoptPenshotCastAll(kind) {
        if (penshotAdoptBusy()) { toast(tr('script.penshotAdoptBusy')); return; }
        const snapshot = currentPenshotSnapshot();
        const group = PENSHOT_CAST_GROUP_BY_KIND[kind];
        if (!snapshot || !group) return;
        const cast = (snapshot.adopted && snapshot.adopted.cast) || {};
        const items = ((snapshot.castPrompts || {})[group.key] || []).filter((item) => {
            if (!item || !item.name) return false;
            return !cast[penshotCastKey(kind, item.name, item.spec)];
        });
        adoptCastItems(kind, items);
    }

    // 复用 mergeCastGap：只插入、不改写、按名字键去重，正合「采用」语义
    function adoptCastItems(kind, items) {
        const list = (items || []).filter((item) => item && item.name);
        if (!list.length) { toast(tr('script.penshotAdoptNothing')); return; }
        const markdown = list.map((item) => `### ${item.name} · ${item.spec}\n\n\`\`\`\n${item.prompt}\n\`\`\`\n`).join('\n');
        const merged = mergeCastGap(kind, markdown);
        if (!merged.count) { toast(tr('script.penshotAdoptNothing')); return; }
        const snapshot = currentPenshotSnapshot();
        if (snapshot) {
            if (!snapshot.adopted || typeof snapshot.adopted !== 'object') snapshot.adopted = {};
            if (!snapshot.adopted.cast || typeof snapshot.adopted.cast !== 'object') snapshot.adopted.cast = {};
            merged.titles.forEach((title) => {
                const key = `${kind}:${castNameKeys(title)[0] || title}`;
                snapshot.adopted.cast[key] = true;
            });
        }
        syncCastGallery();
        saveStoryboardState();
        renderPenshotResult();
        toast(tf('script.penshotCastAdoptedNote', { n: merged.count }));
    }

    function adoptPenshotFragment(fragmentId) {
        if (penshotAdoptBusy()) { toast(tr('script.penshotAdoptBusy')); return; }
        const snapshot = currentPenshotSnapshot();
        if (!snapshot) return;
        const fragment = (snapshot.fragments || []).find((f) => f && f.fragment_id === fragmentId);
        if (fragment) adoptPenshotFragments([fragment]);
    }

    function adoptAllPenshotFragments() {
        if (penshotAdoptBusy()) { toast(tr('script.penshotAdoptBusy')); return; }
        const snapshot = currentPenshotSnapshot();
        if (!snapshot) return;
        const frags = (snapshot.adopted && snapshot.adopted.fragments) || {};
        const pending = (snapshot.fragments || []).filter((f) => f && !frags[f.fragment_id]);
        adoptPenshotFragments(pending);
    }

    // 只能落到 state.results[0].units：跑单个 / 整批只认这一张，新建 episode 会跑不了
    function adoptPenshotFragments(fragments) {
        const list = (fragments || []).filter(Boolean);
        if (!list.length) { toast(tr('script.penshotAdoptNothing')); return; }
        let result = state.results[0];
        if (!result) {                       // 还没有分镜卡片：建一张空的承载卡
            result = { index: 0, title: tr('script.title'), status: 'done', units: [], raw: '' };
            state.results[0] = result;
        }
        const units = result.units || (result.units = []);
        const used = new Set(units.map((unit) => String(unit.code || '').toUpperCase()));
        const snapshot = currentPenshotSnapshot();
        if (snapshot) {
            if (!snapshot.adopted || typeof snapshot.adopted !== 'object') snapshot.adopted = {};
            if (!snapshot.adopted.fragments || typeof snapshot.adopted.fragments !== 'object') snapshot.adopted.fragments = {};
        }
        let num = 1;
        list.forEach((fragment) => {
            while (used.has(`F${String(num).padStart(2, '0')}`)) num += 1;
            const code = `F${String(num).padStart(2, '0')}`;   // F 前缀，避免与 P## / P##A 撞码
            used.add(code);
            num += 1;
            // 片段自带它对应的场景 / 人物：显式绑定参考图，并把 <Picture> / 场景引用写进提示词，
            // 否则场景图因为「名字对不上」既进不了「关联素材」，也不会被接进视频工作流。
            const refNames = penshotFragmentRefNames(fragment);
            const header = penshotRefHeader(refNames);
            units.push({
                code,
                duration: `${Math.round(Number(fragment.duration) || 0)}秒`,
                name: String(fragment.main_character || (fragment.characters && fragment.characters[0]) || ''),
                prompt: header + String(fragment.prompt || ''),
                raw: header + String(fragment.prompt || ''),
                penshotRef: String(fragment.fragment_id || ''),
                penshotExtra: { negative_prompt: fragment.negative_prompt || '', audio: fragment.audio || null },
                refNames,
            });
            if (snapshot) snapshot.adopted.fragments[String(fragment.fragment_id || '')] = true;
        });
        result.status = 'done';
        state.unitsPage = {};
        renderResults();                     // 内含 saveStoryboardState
        renderPenshotResult();               // 同步「已采用」按钮状态
        toast(tf('script.penshotFragmentAdoptedNote', { n: list.length }));
    }

    function handlePenshotEvent(event) {
        if (event.type === 'penshot_start') {
            state.penshot.taskId = event.task_id || '';
            const id = state.penshot.taskId ? ` · ${tf('script.penshotTask', { id: state.penshot.taskId })}` : '';
            $('penshotStatus').textContent = withRefreshWarn(`${tr('script.penshotRunning')}${id}`);
        } else if (event.type === 'penshot_stage') {
            state.penshotProgress = Number(event.progress) || 0;
            // 过程快照同步记进存档（节流落盘），刷新或切剧本回来还能看到上回跑到哪一步
            state.penshot.progress = state.penshotProgress;
            state.penshot.stageCode = String(event.stage || '');
            state.penshot.stageName = String(event.stage_name || '');
            state.penshot.stageResults = event.stage_results && typeof event.stage_results === 'object'
                ? event.stage_results : {};
            state.penshot.stageProgress = event.stages_progress && typeof event.stages_progress === 'object'
                ? event.stages_progress : {};
            renderPenshotProgress(event.progress, event.stage, event.stage_name, event.stage_results, event.stages_progress);
            updatePenshotMeta();
            schedulePenshotPersist();
        } else if (event.type === 'penshot_partial') {
            // 长剧本跑到一半：把「已产出」的分镜提示词先回传，立即并入分镜，不必死等整条管线
            const incoming = Array.isArray(event.fragments) ? event.fragments : [];
            if (incoming.length) {
                state.penshot.fragments = incoming;
                state.penshot.partial = true;
                state.penshot.partialSource = String(event.source || '');
                autoAdoptPenshotFragments(incoming);
                renderPenshotResult();
                $('penshotStatus').textContent = tf('script.penshotPartialGot', { n: incoming.length });
            }
            schedulePenshotPersist();
        } else if (event.type === 'penshot_done') {
            state.penshot.fragments = Array.isArray(event.fragments) ? event.fragments : [];
            state.penshot.metadata = event.metadata || {};
            state.penshot.validation = event.validation || {};
            // 本次新增的中间产物：人物/场景/道具提示词、镜头拆分、质量校验报告
            state.penshot.castPrompts = event.cast_prompts || { characters: [], scenes: [], props: [] };
            state.penshot.shots = Array.isArray(event.shots) ? event.shots : [];
            state.penshot.audit = event.audit || {};
            state.penshot.status = 'done';
            state.penshot.partial = Boolean(event.partial);
            state.penshotProgress = 100;
            state.penshot.progress = 100;
            // 跑完了就不再指「当前 Agent」，但各阶段产出计数留着（renderPenshotProgress 会写进快照）
            state.penshot.stageCode = '';
            state.penshot.stageName = '';
            // 把这次结果封成一份历史快照：多份并存，可来回切换查看
            pushPenshotSnapshot();
            renderPenshotProgress(100, '', '', state.penshot.stageResults, state.penshot.stageProgress);
            updatePenshotMeta();
            renderPenshotResult();
            const n = state.penshot.fragments.length;
            autoAdoptPenshotFragments(state.penshot.fragments);
            if (event.partial) {
                $('penshotStatus').textContent = n
                    ? tf('script.penshotPartialDone', { n, dur: penshotDurationLimit() })
                    : tr('script.penshotPartialEmpty');
            } else {
                $('penshotStatus').textContent = n
                    ? tf('script.penshotDone', { n })
                    : tr('script.penshotNoFragments');
            }
        } else if (event.type === 'penshot_error') {
            state.penshot.status = 'error';
            $('penshotStatus').textContent = tf('script.penshotFailed', { detail: event.detail || '' });
        }
    }

    function setPenshotRunningUI(running) {
        $('penshotRunBtn').hidden = running;
        $('penshotRunBtn').disabled = running;
        $('penshotStopBtn').hidden = !running;
        if (running) $('penshotRerunBtn').hidden = true;
        else syncPenshotRerunUI();
    }

    // force=false：输入没变且已有完整结果时直接读缓存；force=true（点「重新运行」）永远从头跑
    async function submitPenshot(force) {
        const script = $('scriptText').value.trim();
        if (!script) {
            toast(tr('script.penshotNeedScript'));
            return;
        }
        if (!force && penshotCacheHit()) {
            restorePenshotFromCache();
            toast(tf('script.penshotCacheLoaded', { n: state.penshot.fragments.length }));
            return;
        }
        const fresh = penshotState(null);
        // 历史快照、提取时长上限、实时采用开关都沿用用户设的值
        fresh.history = (state.penshot && state.penshot.history) || [];
        fresh.durationLimit = penshotDurationLimit();
        fresh.autoAdopt = penshotAutoAdopt();
        state.penshot = fresh;
        // 记下这次结果对应的输入指纹：跑完后再点「生成」就能直接读回，不必重跑
        state.penshot.signature = penshotSignature();
        state.penshot.status = 'running';
        clearPenshotResultViews();
        $('penshotResult').innerHTML = '';
        $('penshotStages').hidden = false;
        resetPenshotStages();
        // 起跑计时：每秒刷新「已用时 / 进度 / 预计剩余」
        state.penshotStartedAt = Date.now();
        state.penshotProgress = 0;
        startPenshotTimer();
        setPenshotRunningUI(true);
        $('penshotStatus').textContent = withRefreshWarn(tr('script.penshotRunning'));
        const controller = new AbortController();
        state.penshotController = controller;
        try {
            const response = await fetch('/api/script/penshot/breakdown', {
                method: 'POST',
                headers: jsonHeaders,
                signal: controller.signal,
                body: JSON.stringify({
                    provider: state.providerId,
                    model: state.model,
                    ms_model: state.providerId === 'modelscope' ? state.model : '',
                    script,
                    style_id: state.styleId,
                    // 同一份剧本复用记忆，跨批次保持一致性与场景连续性
                    script_id: scriptProjectId || '',
                    // 提取时长上限：按已提取分镜的累计时长停止，0 = 提取全部
                    duration_limit: penshotDurationLimit(),
                }),
            });
            if (!response.ok) {
                const detail = await response.json().catch(() => ({}));
                state.penshot.status = 'error';
                $('penshotStatus').textContent = tf('script.penshotFailed', { detail: detail.detail || `HTTP ${response.status}` });
                return;
            }
            await consumeStream(response, handlePenshotEvent);
            if (state.penshot.status === 'running') state.penshot.status = 'done';
        } catch (error) {
            if (error && error.name === 'AbortError') {
                state.penshot.status = 'stopped';
                $('penshotStatus').textContent = tr('script.penshotStopped');
            } else {
                state.penshot.status = 'error';
                $('penshotStatus').textContent = tf('script.penshotFailed', { detail: String(error) });
            }
        } finally {
            state.penshotController = null;
            stopPenshotTimer();
            updatePenshotMeta();
            // 收尾这一刻冻结已用时与进度，并立刻把整份工作区写到本机文件：刷新 / 切剧本回来能原样看到这次的过程与结果
            state.penshot.elapsedMs = state.penshotStartedAt ? Date.now() - state.penshotStartedAt : state.penshot.elapsedMs;
            state.penshot.progress = state.penshotProgress;
            state.penshot.finishedAt = Date.now();
            flushPenshotPersist(true);
            setPenshotRunningUI(false);
        }
    }

    // 切剧本、刷新页面时把存档的 PenShot 结果与中间过程换成本剧本的（没有就清空重来）
    function applyPenshotState(saved) {
        state.penshot = penshotState(saved);
        const data = state.penshot;
        // 提取时长上限 / 实时采用开关随剧本各记各的，切剧本时控件跟着变
        const durInput = $('penshotDurationLimit');
        if (durInput) durInput.value = String(data.durationLimit || 0);
        const autoInput = $('penshotAutoAdopt');
        if (autoInput) autoInput.checked = data.autoAdopt !== false;
        clearPenshotRun();
        if (data.stages) {
            // 有过程快照：7 行阶段条与当时的进度 / 各阶段产出照存照画，不动它
            $('penshotStages').hidden = false;
            restorePenshotStages(data.stages, data.stageCode, data.stageName, data.stageResults, data.stageProgress);
            renderPenshotMetaFrozen(data.elapsedMs, data.progress);
        } else if (data.fragments.length) {
            // 老存档只有结果没有过程：退回「整个跑完」的画法
            $('penshotStages').hidden = false;
            renderPenshotProgress(100, '', '', data.stageResults, data.stageProgress);
        } else {
            $('penshotStages').hidden = true;
            resetPenshotStages();
        }
        if (data.fragments.length) {
            $('penshotStatus').textContent = tf('script.penshotDone', { n: data.fragments.length });
        } else if (data.stages && data.status === 'running') {
            // 上回跑到一半页面就关了 / 刷新了，把中断提示出来
            $('penshotStatus').textContent = tr('script.penshotInterrupted');
        } else {
            $('penshotStatus').textContent = '';
        }
        renderPenshotResult();
        syncPenshotAdoptUI();
        syncPenshotRerunUI();
    }

    // 三个文本框的 id，按类型取
    const CAST_TEXTAREA_ID = { character: 'castCharacters', scene: 'castScenes', prop: 'castProps' };
    // 正在重写提示词的条目（key 形如 "character:0"），按钮上显示「重写中…」
    const castPromptRedo = new Set();

    // 这一段标题下面有没有代码块？没有就不构成一条条目（parseCastItems 也是这么算的）
    function castBlockHasFence(lines, at) {
        for (let k = at + 1; k < lines.length; k += 1) {
            if (/^(#{2,4})[ \t]+/.test(lines[k])) return false;
            if (lines[k].trim().startsWith('```')) return true;
        }
        return false;
    }

    // 把某一条在文本框里的正文换掉：条目是从「### 标题 + ```text 代码块」解析出来的，
    // 按标题定位最准；正负词分成两块的那种，一并收成一块。
    function replaceCastPromptText(kind, index, newPrompt) {
        const area = $(CAST_TEXTAREA_ID[kind]);
        const target = (state.castItems[kind] || [])[index];
        if (!area || !target) return false;
        const lines = area.value.split('\n');
        let seen = -1;
        for (let i = 0; i < lines.length; i += 1) {
            const heading = /^(#{2,4})[ \t]+(.+?)[ \t]*$/.exec(lines[i]);
            if (!heading || heading[1].length < 3 || !castBlockHasFence(lines, i)) continue;
            seen += 1;
            if (seen !== index) continue;
            // 序号对上了，但标题不一致就不动它——宁可报错也不能改错人
            if (castItemTitle(heading[2]) !== target.title) return false;
            let end = i + 1;
            while (end < lines.length && !/^(#{2,4})[ \t]+/.test(lines[end])) end += 1;
            const block = [lines[i], '', '```text', newPrompt, '```', ''];
            area.value = lines.slice(0, i).concat(block, lines.slice(end)).join('\n');
            return true;
        }
        return false;
    }

    // 「重新生成提示词」（单条）：让模型只重写这一条，再替换回对应的文本框。
    // 提示词变了，这张图就跟设定对不上了——castShotOf 会判它失效，卡片回到「待生成」，需要再点「重新生成素材」。
    async function redoCastItemPrompt(key) {
        const entry = findCastEntry(key);
        if (!entry) return;
        const { item, index } = entry;
        if (castPromptRedo.has(key)) return;
        if (!scriptContent()) {
            toast(tr('script.needText'));
            return;
        }
        if (!currentCastTemplate()) {
            toast(tr('script.castNoTemplate'));
            return;
        }
        castPromptRedo.add(key);
        renderCastGallery();
        try {
            const response = await fetch('/api/script/cast-item', {
                method: 'POST',
                headers: jsonHeaders,
                body: JSON.stringify({
                    provider: state.providerId,
                    model: state.model,
                    ms_model: state.providerId === 'modelscope' ? state.model : '',
                    template_id: state.castTemplateId,
                    script: scriptContent(),
                    style_id: state.styleId,
                    kind: item.kind,
                    title: item.title,
                    prompt: item.prompt,
                }),
            });
            if (!response.ok) {
                const detail = await response.json().catch(() => ({}));
                throw new Error(detail.detail || `HTTP ${response.status}`);
            }
            const data = await response.json();
            const text = String(data.prompt || '').trim();
            if (!text) throw new Error(tr('script.itemRedoEmpty'));
            if (!replaceCastPromptText(item.kind, index, text)) throw new Error(tr('script.itemRedoMiss'));
            toast(tf('script.itemRedoDone', { name: item.title }));
        } catch (error) {
            toast(String(error.message || error));
        } finally {
            castPromptRedo.delete(key);
            syncCastGallery();
        }
    }

    // only 传 'character' / 'scene' / 'prop' 时只重出那一类，另外两类一个字都不动
    //（已经生成的参考图是靠提示词匹配的，重写别的部分会把那些图全冲掉）
    async function generateCast(only) {
        if (state.castRunning) return;
        if (!scriptContent()) {
            toast(tr('script.needText'));
            return;
        }
        if (!currentCastTemplate()) {
            toast(tr('script.castNoTemplate'));
            return;
        }

        state.castRunning = true;
        state.castController = new AbortController();
        setCastRunningUI(true);
        $('castStatus').textContent = tr('script.castRunning');

        try {
            const response = await fetch('/api/script/cast', {
                method: 'POST',
                headers: jsonHeaders,
                signal: state.castController.signal,
                body: JSON.stringify({
                    provider: state.providerId,
                    model: state.model,
                    ms_model: state.providerId === 'modelscope' ? state.model : '',
                    template_id: state.castTemplateId,
                    script: scriptContent(),
                    kind: only || '',
                    style_id: state.styleId,
                }),
            });
            if (!response.ok) {
                const detail = await response.json().catch(() => ({}));
                throw new Error(detail.detail || `HTTP ${response.status}`);
            }
            await consumeStream(response, handleCastEvent);
        } catch (error) {
            const message = error.name === 'AbortError' ? tr('script.castStopped') : String(error.message || error);
            if (error.name !== 'AbortError') toast(message);
            $('castStatus').textContent = message;
        } finally {
            state.castRunning = false;
            state.castController = null;
            setCastRunningUI(false);
        }
    }

    // 「检查漏掉的人物/场景/道具」：对照剧本正文与已生成分镜，只把漏掉的条目补进来。
    // 三个文本框只做插入、不改写，已有条目的提示词与参考图全部原样留着。
    async function checkMissingCast() {
        if (state.castRunning) return;
        if (!scriptContent()) {
            toast(tr('script.needText'));
            return;
        }
        if (!currentCastTemplate()) {
            toast(tr('script.castNoTemplate'));
            return;
        }

        state.castRunning = true;
        state.castController = new AbortController();
        setCastRunningUI(true);
        $('castStatus').textContent = tr('script.castCheckRunning');

        try {
            const response = await fetch('/api/script/cast-missing', {
                method: 'POST',
                headers: jsonHeaders,
                signal: state.castController.signal,
                body: JSON.stringify({
                    provider: state.providerId,
                    model: state.model,
                    ms_model: state.providerId === 'modelscope' ? state.model : '',
                    template_id: state.castTemplateId,
                    script: scriptContent(),
                    style_id: state.styleId,
                    characters: $('castCharacters').value,
                    scenes: $('castScenes').value,
                    props: $('castProps').value,
                    storyboard_digest: storyboardDigest(),
                }),
            });
            if (!response.ok) {
                const detail = await response.json().catch(() => ({}));
                throw new Error(detail.detail || `HTTP ${response.status}`);
            }
            await consumeStream(response, handleCastEvent);
        } catch (error) {
            const message = error.name === 'AbortError' ? tr('script.castStopped') : String(error.message || error);
            if (error.name !== 'AbortError') toast(message);
            $('castStatus').textContent = message;
        } finally {
            state.castRunning = false;
            state.castController = null;
            setCastRunningUI(false);
        }
    }

    // 分镜提示词必须建立在人物与场景设定之上：没有结果就不让生成
    function syncGenerateEnabled() {
        const ready = Boolean(castAllText().trim());
        $('generateBtn').disabled = !ready;
        $('generateHint').hidden = ready;
    }

    // ---------- 本地持久化 ----------
    // 人物与场景（含已生成的参考图）刷新页面后不该重来一遍，统一存在 localStorage 里。
    // 参考图落在本地 output 目录，URL 形如 /assets/...，重启服务也还在。
    // 旧键里可能存着被别的页面覆盖过的错误内容（人物场景、分镜都会被整份写回服务端），
    // 换新键让所有浏览器忽略旧副本、一律从服务端重新拉，避免旧页面把错数据再写回去。
    const CAST_STORE_KEY = 'studio_script_cast_state_v2';

    function saveCastState() {
        try {
            localStorage.setItem(CAST_STORE_KEY, JSON.stringify({
                // 内容自带归属，恢复时用它核对这份内容到底是不是当前剧本的
                projectId: scriptProjectId,
                script: $('scriptText').value,
                cast_characters: $('castCharacters').value,
                cast_scenes: $('castScenes').value,
                cast_props: $('castProps').value,
                ...castStateSnapshot(),
            }));
        } catch (error) { /* 隐私模式或超配额时静默跳过 */ }
        markLocalWorkspaceOwner();
        markLocalEditAt();
        scheduleScriptProjectSave();
    }

    // 剧本可能有几万字，边打字边写盘太浪费，攒一下再存
    let castSaveTimer = null;
    function scheduleCastSave() {
        clearTimeout(castSaveTimer);
        castSaveTimer = setTimeout(saveCastState, 500);
    }

    function restoreCastState() {
        let saved = null;
        try {
            saved = JSON.parse(localStorage.getItem(CAST_STORE_KEY) || 'null');
        } catch (error) {
            saved = null;
        }
        if (!saved) return;
        $('scriptText').value = saved.script || '';
        $('castCharacters').value = saved.cast_characters || '';
        $('castScenes').value = saved.cast_scenes || '';
        $('castProps').value = saved.cast_props || '';
        // 老版本存的是合在一起的一份，没有新字段就切回三个框
        if (!saved.cast_characters && !saved.cast_scenes && !saved.cast_props && saved.cast) {
            const parts = splitCastMarkdown(saved.cast);
            setCastText(parts.character, parts.scene, parts.prop);
        }
        // 上次选的是在线生图还是 ComfyUI 工作流也一起恢复，免得刷新后误发到另一个引擎
        if (saved.engine === 'online' || saved.engine === 'comfy') state.imageEngine = saved.engine;
        if (saved.collapsed) {
            state.castCollapsed = {
                character: saved.collapsed.character === true,
                scene: saved.collapsed.scene === true,
                prop: saved.collapsed.prop === true,
            };
        }
        state.castShots = saved.shots || {};
        if (saved.kinds && typeof saved.kinds === 'object') {
            CAST_KINDS.forEach((kind) => { state.castKinds[kind] = saved.kinds[kind] === true; });
        } else if (String(saved.cast_characters || saved.cast_scenes || saved.cast_props || '').trim()) {
            // 老快照没有「生成过哪几类」这个字段：只要有清单就三类全放行，
            // 别让「检查漏掉的条目」按钮对老剧本永远不出现
            CAST_KINDS.forEach((kind) => { state.castKinds[kind] = true; });
        }
    }

    // 分镜提示词（含每个单元跑出来的视频）也存一份，刷新后不用重新点生成。
    // 和人物场景分开存：剧本那几十 KB 每次打字都要重写，不该捎上分镜这块更大的数据。
    const STORYBOARD_STORE_KEY = 'studio_script_storyboard_state_v2';

    // 要留存的那份快照：生成中的一律按「已停止」记，恢复后点继续生成就能接着跑。
    // 浏览器本地存储和「保存到本机」用的是同一份，两边内容永远一致。
    function storyboardSnapshot() {
        const results = state.results.map((item) => (
            item.status === 'pending' || item.status === 'running'
                ? { ...item, status: 'paused' }
                : item
        ));
        // 断点（剩余分段 + 已完成计数）也带上，加载后还能接着生成
        return { results, session: state.session, penshot: state.penshot, shotSkill: state.shotSkill };
    }

    function applyStoryboardState(results, session) {
        state.results = Array.isArray(results) ? results : [];
        // 老数据里的成片记录没有版本信息，先补齐，之后重新生成才能按版本留着旧的
        state.results.forEach((item) => ((item && item.units) || []).forEach(normalizeUnitRuns));
        state.session = session && Array.isArray(session.queue) ? session : null;
    }

    function saveStoryboardState() {
        try {
            // 同上：快照里带上归属，免得一份「别人剧本」的分镜被当成当前剧本的
            localStorage.setItem(STORYBOARD_STORE_KEY, JSON.stringify({
                ...storyboardSnapshot(),
                projectId: scriptProjectId,
            }));
        } catch (error) { /* 隐私模式或超配额时静默跳过 */ }
        markLocalWorkspaceOwner();
        markLocalEditAt();
        scheduleScriptProjectSave();
    }

    function restoreStoryboardState() {
        let saved = null;
        try {
            saved = JSON.parse(localStorage.getItem(STORYBOARD_STORE_KEY) || 'null');
        } catch (error) {
            saved = null;
        }
        applyStoryboardState(saved && saved.results, saved && saved.session);
        applyPenshotState(saved && saved.penshot);
        applyShotSkillState(saved && saved.shotSkill);
    }

    // ---------- 剧本库（一个剧本 = 一整套工作区）----------
    // 浏览器本地存储只装得下一个剧本，要同时管几个就得放到本机文件里
    // （后端 data/script_projects.json）。一份剧本 = 正文 + 人物与场景（含参考图）
    // + 分镜提示词 + 断点；切换剧本就是整套换掉，各存各的进度。
    const SCRIPT_PROJECT_KEY = 'studio_script_project_id';
    // 本地这两份内容属于哪个剧本：刷新时靠它判断「手上这份就是最新的」，
    // 免得刚打完字 1 秒内刷新，被本机文件里那份旧内容盖回去
    const SCRIPT_PROJECT_OWNER_KEY = 'studio_script_project_owner_v2';
    // 本地这两份最后改过的时间。刷新时拿它跟本机文件的 updated_at 比：
    // 只有本地改动发生在本机文件之后，手上这份才是「刚改完还没落盘」的最新版本
    const LOCAL_EDIT_AT_KEY = 'studio_script_local_edit_v2';

    let scriptProjects = [];          // 列表缓存，只有摘要（名字 / 分镜数 / 已完成数）
    let scriptProjectId = '';         // 当前剧本
    let scriptProjectName = '';
    let scriptProjectTimer = null;    // 自动保存的防抖
    let scriptProjectBusy = false;    // 正在切换、套用数据，这期间不许自动保存
    let scriptProjectSignature = '';  // 上次存盘时的内容指纹，见 workspaceSignature
    // 只有点「清空」才会置真，跟这次保存一起送上去：服务端默认拒绝把已有的分镜整份清空，
    // 免得某个还开着的旧页面（内存里是空的分镜）自动保存时把别处生成好的分镜抹掉
    let allowClearOnce = false;
    // 当前剧本的素材库：一个剧本一套（角色 / 场景 / 生成图片 / 生成视频），出图出片往这里放
    let scriptAssetLibraryId = '';

    // 人物与场景那份快照：本地存储和剧本库两边共用，内容永远一致
    function castStateSnapshot() {
        const shots = {};
        Object.keys(state.castShots).forEach((key) => {
            const shot = state.castShots[key];
            // 生成中的任务刷新后续不上，不写入，免得恢复出一个假的「生成中」
            if (!shot || shot.status === 'running') return;
            shots[key] = shot;
        });
        return { engine: state.imageEngine, collapsed: state.castCollapsed, shots, kinds: state.castKinds };
    }

    // 一段文字压成一个整数，给内容指纹用（分镜提示词是可以手改的，光看条数看不出变化）
    function textHash(text) {
        const str = String(text || '');
        let hash = 0;
        for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) | 0;
        return hash;
    }

    // 内容指纹：生成过程中进度百分比一直在动，但那些不用存盘。只算「该留的」——
    // 正文与人物场景道具的长度、分镜数、每个分镜跑没跑完、断点还剩几段，
    // 以及每个单元提示词的正文（用户可能只改了文字，条数和状态都没变）。
    function workspaceSignature(workspace) {
        const units = workspace.results.reduce((all, item) => all.concat((item && item.units) || []), []);
        // PenShot 只算粗粒度标记（状态 / 结果条数 / 输入指纹）：过程进度每秒都在动，
        // 真算进去会让整份工作区文件每两秒重写一遍；细粒度过程走浏览器本地那份，够用。
        const penshot = workspace.penshot || {};
        return [
            workspace.script.length,
            String(workspace.cast_characters || '').length,
            String(workspace.cast_scenes || '').length,
            String(workspace.cast_props || '').length,
            String(workspace.style_id || ''),
            units.length,
            units.map((unit) => ((unit.run || {}).status || '-')).join(','),
            units.reduce((acc, unit) => (acc * 31 + textHash(unit.prompt || unit.raw || '')) | 0, 0),
            (workspace.session && workspace.session.queue ? workspace.session.queue.length : 0),
            String(penshot.status || ''),
            (Array.isArray(penshot.fragments) ? penshot.fragments.length : 0),
            String(penshot.signature || ''),
            // 快照份数 / 当前查看哪份 / 每份的「已采用」数量：采用只改这些标记、不改分镜条数，
            // 不纳入指纹的话 flushScriptProject 会按内容指纹跳过写盘，「已采用」刷新后就丢了。
            // 仍然不含 progress，不会造成每秒重写。
            (Array.isArray(penshot.history) ? penshot.history.length : 0),
            String(penshot.currentId || ''),
            (Array.isArray(penshot.history) ? penshot.history : []).map((snap) => (
                `${(snap && snap.id) || ''}:${Object.keys((snap && snap.adopted && snap.adopted.cast) || {}).length}:${Object.keys((snap && snap.adopted && snap.adopted.fragments) || {}).length}`
            )).join(','),
            // 第六步 技能提取结果：只算条数 / 状态 / 技能 id，够判断有没有变
            String((workspace.shot_skill || {}).status || ''),
            String((workspace.shot_skill || {}).skillId || ''),
            (((workspace.shot_skill || {}).shots || []).length),
        ].join('|');
    }

    function currentWorkspace() {
        const snapshot = storyboardSnapshot();
        return {
            name: scriptProjectName,
            script: $('scriptText').value,
            cast_characters: $('castCharacters').value,
            cast_scenes: $('castScenes').value,
            cast_props: $('castProps').value,
            cast_state: castStateSnapshot(),
            style_id: state.styleId,
            results: snapshot.results,
            session: snapshot.session,
            // PenShot 结果随剧本一起存：切走再切回来还在，不覆盖人物/场景/分镜
            penshot: state.penshot,
            // 技能提取的分镜提示词结果随剧本一起存，同上不覆盖已有字段
            shot_skill: state.shotSkill,
            allow_clear: allowClearOnce,
        };
    }

    function emptyWorkspace() {
        return {
            name: '',
            script: '',
            cast: '',
            cast_characters: '',
            cast_scenes: '',
            cast_props: '',
            cast_state: {},
            style_id: '',
            results: [],
            session: null,
            penshot: penshotState(null),
            shot_skill: shotSkillState(null),
        };
    }

    function markLocalWorkspaceOwner() {
        try {
            if (scriptProjectId) localStorage.setItem(SCRIPT_PROJECT_OWNER_KEY, scriptProjectId);
        } catch (error) { /* 隐私模式或超配额时静默跳过 */ }
    }

    // 本地那份内容里自带的「属于哪个剧本」。外面那个 owner 键只记「当前选的是谁」，
    // 和内容一旦不同步（比如旧页面把别的剧本的内容写进了本地），刷新后就会张冠李戴、
    // 再把错内容推回服务端。所以内容自己也要带上身份，恢复时对不上就一律以服务端为准。
    function localSnapshotProjectId(key) {
        try {
            const saved = JSON.parse(localStorage.getItem(key) || 'null');
            return String((saved && saved.projectId) || '');
        } catch (error) {
            return '';
        }
    }

    // 本地这两份最后改动的时间。刷新时拿它跟本机文件的 updated_at 比，判断手上这份
    // 是不是「刚改完还没落盘」的最新版本；只在本机内容真的被改过时才更新它
    function markLocalEditAt() {
        try {
            if (scriptProjectId) localStorage.setItem(LOCAL_EDIT_AT_KEY, String(Date.now()));
        } catch (error) { /* 隐私模式或超配额时静默跳过 */ }
    }

    // 套用一份剧本：正文、人物场景、参考图、分镜、断点整套换掉，然后把页面重画一遍
    function applyWorkspace(data) {
        scriptProjectBusy = true;
        try {
            $('scriptText').value = String(data.script || '');
            const characters = String(data.cast_characters || '');
            const scenes = String(data.cast_scenes || '');
            const props = String(data.cast_props || '');
            if (characters || scenes || props) {
                setCastText(characters, scenes, props);
            } else {
                // 老剧本只存了合在一起的一份，切回三个框
                const parts = splitCastMarkdown(data.cast || '');
                setCastText(parts.character, parts.scene, parts.prop);
            }
            const castState = data.cast_state || {};
            // 生图引擎按剧本各记各的，切换后别把在线生图串到 ComfyUI 上
            if (castState.engine === 'online' || castState.engine === 'comfy') state.imageEngine = castState.engine;
            if (castState.collapsed) {
                state.castCollapsed = {
                    character: castState.collapsed.character === true,
                    scene: castState.collapsed.scene === true,
                    prop: castState.collapsed.prop === true,
                };
            }
            state.castShots = castState.shots || {};
            if (castState.kinds && typeof castState.kinds === 'object') {
                CAST_KINDS.forEach((kind) => { state.castKinds[kind] = castState.kinds[kind] === true; });
            } else if (String(data.cast_characters || data.cast_scenes || data.cast_props || '').trim()) {
                // 老剧本没有「生成过哪几类」这个字段：只要有清单就三类全放行
                CAST_KINDS.forEach((kind) => { state.castKinds[kind] = true; });
            }
            // 画风按剧本各记各的：老剧本没存过就回到默认（第一个）
            const savedStyle = String(data.style_id || '');
            state.styleId = state.styles.some((item) => item.id === savedStyle)
                ? savedStyle
                : (state.styles.length ? state.styles[0].id : '');
            renderCastStyleOptions();
            // PenShot 卡片里也有一个同源画风下拉，换剧本时要一起跟着变，否则两个下拉会显示成两个画风
            renderPenshotStyleOptions();
            applyStoryboardState(data.results, data.session);
            // PenShot 结果按剧本各记各的：切走再切回来还在
            applyPenshotState(data.penshot);
            // 技能提取结果按剧本各记各的：切走再切回来还在
            applyShotSkillState(data.shot_skill);
            // 翻到第几页、停止标记这些是上一个剧本的状态，别带过来
            state.unitsPage = {};
            state.comfyStop = false;
        } finally {
            scriptProjectBusy = false;
        }
        updateScriptSummary();
        syncGenerateEnabled();
        renderImageOptions();
        syncCastGallery();
        // 切到另一个剧本时同样补一次：这边的素材图可能也是同步逻辑上线前出好的
        backfillUnitRefSync();
        // PenShot 采用过来的分镜：补上片段对应的场景 / 人物参考图
        backfillPenshotUnitRefs();
        renderResults();
        setRunningUI(false);
        // 记下刚套上来的指纹：上面这几步会顺手落盘，别再把整份原样写回去
        scriptProjectSignature = workspaceSignature(currentWorkspace());
        markLocalWorkspaceOwner();
        renderScriptProjectBar();
    }

    // 下拉里一行：名字 · 已完成/总分镜
    function scriptProjectLabel(item) {
        const name = item.name || tr('script.projUntitled');
        return item.unit_count ? `${name} · ${item.done_count}/${item.unit_count}` : name;
    }

    function renderScriptProjectBar() {
        const select = $('scriptProjectSelect');
        if (!select) return;
        select.innerHTML = scriptProjects.length
            ? scriptProjects.map((item) => (
                `<option value="${esc(item.id)}"${item.id === scriptProjectId ? ' selected' : ''}>${esc(scriptProjectLabel(item))}</option>`
            )).join('')
            : `<option value="">${esc(tr('script.projNone'))}</option>`;
        $('renameScriptBtn').disabled = !scriptProjectId;
        $('deleteScriptBtn').disabled = !scriptProjectId;
    }

    function setScriptProjectHint(text, kind) {
        const box = $('scriptProjectSaved');
        if (!box) return;
        box.textContent = text || '';
        box.className = kind ? `script-bar-hint ${kind}` : 'script-bar-hint';
    }

    async function fetchScriptProjects() {
        const response = await fetch('/api/script/projects', { cache: 'no-store' });
        if (!response.ok) throw new Error(await errorMessage(response));
        const data = await response.json();
        scriptProjects = ((data || {}).items) || [];
        return scriptProjects;
    }

    // 自动保存：改完隔一会儿再写，别敲一个字就整份写盘
    function scheduleScriptProjectSave() {
        if (scriptProjectBusy || !scriptProjectId) return;
        clearTimeout(scriptProjectTimer);
        scriptProjectTimer = setTimeout(() => { flushScriptProject(); }, 1500);
    }

    // 这一批 results 里一共有多少条分镜
    function resultsUnitCount(results) {
        return (results || []).reduce((total, item) => total + (((item || {}).units) || []).length, 0);
    }

    async function flushScriptProject(options) {
        if (scriptProjectBusy || !scriptProjectId) return;
        const force = !!(options && options.force);
        const workspace = currentWorkspace();
        // 刚点下「生成」、这一轮还一条分镜都没产出时，手里这份是空的：写上去只会被服务端的
        // 防清空守卫拦下、弹一句吓人的「保存失败」。等第一条出来了再存。
        if (state.running && !resultsUnitCount(workspace.results)) return;
        const signature = workspaceSignature(workspace);
        // 指纹没变就不用写：几 MB 的文件两秒重写一遍太浪费
        if (!force && signature === scriptProjectSignature) return;
        const target = scriptProjectId;
        scriptProjectSignature = signature;
        try {
            const response = await fetch(`/api/script/projects/${target}`, {
                method: 'PUT',
                headers: jsonHeaders,
                body: JSON.stringify(workspace),
            });
            if (!response.ok) throw new Error(await errorMessage(response));
            const data = await response.json();
            allowClearOnce = false;
            if (target !== scriptProjectId || !data.item) return;
            scriptProjectName = data.item.name || scriptProjectName;
            scriptProjects = scriptProjects.map((item) => (item.id === target ? data.item : item));
            renderScriptProjectBar();
            setScriptProjectHint(tf('script.projSavedAt', { time: shortTime(data.item.updated_at) }), '');
        } catch (error) {
            // 存不上别把指纹留着：下次有变化还得再试一遍
            scriptProjectSignature = '';
            setScriptProjectHint(tf('script.projSaveFailed', { detail: String(error.message || error) }), 'fail');
        }
    }

    async function loadScriptProject(projectId) {
        const response = await fetch(`/api/script/projects/${projectId}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(await errorMessage(response));
        const data = await response.json();
        scriptProjectId = projectId;
        scriptProjectName = (data.item || {}).name || '';
        localStorage.setItem(SCRIPT_PROJECT_KEY, projectId);
        applyWorkspace(data);
        // 本机文件读不到时（后端没起来）还能退回浏览器里这份
        saveCastState();
        saveStoryboardState();
        setScriptProjectHint(tf('script.projSavedAt', { time: shortTime(data.item.updated_at) }), '');
        // 这个剧本的素材库先确保建好，后面出图出片才知道往哪个库放
        await ensureScriptAssetLibrary();
        // 素材库里已有的角色 / 场景参考图按条目名认回来
        await matchCastLibraryImages();
        return data;
    }

    // 素材库按剧本各建一套：角色 / 场景 / 生成图片 / 生成视频 四个分组，
    // 后端把库 id 记在剧本上，切回来直接复用；建库失败不拦着切剧本，落库时还会退回老库。
    async function ensureScriptAssetLibrary() {
        if (!scriptProjectId) {
            scriptAssetLibraryId = '';
            return '';
        }
        try {
            const response = await fetch(`/api/script/projects/${encodeURIComponent(scriptProjectId)}/asset-library`, {
                method: 'POST',
                headers: jsonHeaders,
                body: JSON.stringify({ name: scriptProjectName }),
            });
            if (!response.ok) throw new Error(await errorMessage(response));
            const data = await response.json().catch(() => ({}));
            scriptAssetLibraryId = data.library_id || '';
        } catch (error) {
            scriptAssetLibraryId = '';
        }
        return scriptAssetLibraryId;
    }

    // 手上这份先存好再动别的，不然切走就丢了
    async function flushBeforeSwitch() {
        clearTimeout(scriptProjectTimer);
        await flushScriptProject({ force: true });
    }

    function scriptProjectLocked() {
        // 正跑着分镜时不让换剧本：任务池认的是当前这批分镜，换了会对不上
        if (state.running || unitRunPool.running) {
            toast(tr('script.projBusy'));
            return true;
        }
        return false;
    }

    async function switchScriptProject(projectId) {
        if (!projectId || projectId === scriptProjectId) return;
        if (scriptProjectLocked()) {
            renderScriptProjectBar();
            return;
        }
        const previous = scriptProjectId;
        await flushBeforeSwitch();
        try {
            await loadScriptProject(projectId);
            setScriptProjectHint('', '');
        } catch (error) {
            scriptProjectId = previous;
            renderScriptProjectBar();
            toast(tf('script.projSwitchFailed', { detail: String(error.message || error) }));
        }
    }

    async function createScriptProject(name, workspace) {
        const response = await fetch('/api/script/projects', {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify({ ...(workspace || emptyWorkspace()), name }),
        });
        if (!response.ok) throw new Error(await errorMessage(response));
        const data = await response.json();
        scriptProjects.unshift(data.item);
        await loadScriptProject(data.item.id);
        return data.item;
    }

    async function newScriptProject() {
        if (scriptProjectLocked()) return;
        const name = window.prompt(tr('script.projNamePrompt'), `${tr('script.projDefaultName')} ${scriptProjects.length + 1}`);
        if (name === null) return;
        await flushBeforeSwitch();
        try {
            const item = await createScriptProject(String(name).trim(), emptyWorkspace());
            setScriptProjectHint('', '');
            toast(tf('script.projCreated', { name: item.name }));
        } catch (error) {
            toast(String(error.message || error));
        }
    }

    async function renameScriptProject() {
        if (!scriptProjectId) return;
        const name = window.prompt(tr('script.projNamePrompt'), scriptProjectName);
        if (name === null) return;
        scriptProjectName = String(name).trim().slice(0, 60) || scriptProjectName;
        await flushScriptProject({ force: true });
        // 素材库跟着剧本名走，方便在素材库面板里认出来
        await ensureScriptAssetLibrary();
        toast(tf('script.projRenamed', { name: scriptProjectName }));
    }

    async function deleteScriptProject() {
        if (scriptProjectLocked() || !scriptProjectId) return;
        const item = scriptProjects.find((row) => row.id === scriptProjectId) || { name: scriptProjectName };
        if (!window.confirm(tf('script.projDeleteConfirm', { name: item.name || '' }))) return;
        try {
            const response = await fetch(`/api/script/projects/${scriptProjectId}`, { method: 'DELETE' });
            if (!response.ok) throw new Error(await errorMessage(response));
            scriptProjects = scriptProjects.filter((row) => row.id !== scriptProjectId);
            scriptProjectId = '';
            localStorage.removeItem(SCRIPT_PROJECT_KEY);
            toast(tf('script.projDeleted', { name: item.name || '' }));
            // 手上那份删了：接着管下一份；一份都不剩就开个空白剧本
            if (scriptProjects.length) await loadScriptProject(scriptProjects[0].id);
            else await createScriptProject(`${tr('script.projDefaultName')} 1`, emptyWorkspace());
        } catch (error) {
            toast(String(error.message || error));
        }
    }

    async function restoreScriptProject() {
        try {
            await fetchScriptProjects();
        } catch (error) {
            // 本机文件读不到（比如后端还没更新上来）：先按浏览器里那份继续用
            renderScriptProjectBar();
            setScriptProjectHint(tr('script.projOffline'), 'fail');
            return;
        }
        if (!scriptProjects.length) {
            // 本机还空着：把浏览器里现存的那份收成第一个剧本。
            // 那可能是几百个分镜的老数据，不收起来的话一升级就像「什么都没了」
            try {
                await createScriptProject(`${tr('script.projDefaultName')} 1`, currentWorkspace());
                setScriptProjectHint('', '');
            } catch (error) {
                setScriptProjectHint(String(error.message || error), 'fail');
            }
            return;
        }
        const savedId = localStorage.getItem(SCRIPT_PROJECT_KEY) || '';
        const target = scriptProjects.find((item) => item.id === savedId) || scriptProjects[0];
        // 本地这两份就是当前剧本的内容（刚敲的字还没写到本机文件里）：直接用本地的，
        // 别再拿本机文件里那份旧的盖回去。
        // 判断依据是时间：本机文件每次落盘都会更新 updated_at，本地每次改动都记一个时间戳。
        // 只有本地改动发生在本机文件之后，手上这份才最新；否则以本机文件为准 ——
        // 免得某个还开着的老页面把它那份旧的人物 / 场景推回本机文件。
        let owner = '';
        try {
            owner = localStorage.getItem(SCRIPT_PROJECT_OWNER_KEY) || '';
        } catch (error) {
            owner = '';
        }
        const localEditAt = Number(localStorage.getItem(LOCAL_EDIT_AT_KEY)) || 0;
        const storedUpdatedAt = Number(target.updated_at) || 0;
        // 除了外面那个「当前选的是谁」的标记，还要内容自己说得出归属：
        // 两份本地副本必须都是这个剧本的。对不上（老页面写串过、或是没带归属的旧数据）
        // 一律读服务端——宁可丢一次没落盘的手改，也不能把别的剧本的内容推回这个剧本。
        const localBelongs = localSnapshotProjectId(CAST_STORE_KEY) === target.id
            && localSnapshotProjectId(STORYBOARD_STORE_KEY) === target.id;
        if (owner === target.id && localBelongs && localEditAt > storedUpdatedAt) {
            scriptProjectId = target.id;
            scriptProjectName = target.name || '';
            markLocalWorkspaceOwner();
            renderScriptProjectBar();
            return;
        }
        try {
            await loadScriptProject(target.id);
        } catch (error) {
            renderScriptProjectBar();
            setScriptProjectHint(String(error.message || error), 'fail');
        }
    }

    // ---------- 人物与场景参考图 ----------
    // 与后端 CHAT_RATIO_SIZE_OPTIONS 对齐：比例 × 分辨率档位 → 实际像素
    const IMAGE_RATIO_SIZES = {
        '1:1': ['1024x1024', '1536x1536', '2048x2048'],
        '2:3': ['720x1080', '1024x1536', '1365x2048'],
        '3:2': ['1080x720', '1536x1024', '2048x1365'],
        '3:4': ['1008x1344', '1536x2048', '2448x3264'],
        '4:3': ['1344x1008', '2048x1536', '3264x2448'],
        '9:16': ['720x1280', '1080x1920', '1440x2560'],
        '16:9': ['1280x720', '1920x1080', '2560x1440'],
    };
    const IMAGE_RATIO_ORDER = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'];
    const IMAGE_RESOLUTIONS = ['1k', '2k', '4k'];
    const CAST_IMAGE_CONCURRENCY = 2;
    const CAST_IMAGE_POLL_MS = 2000;

    function renderImageProviders() {
        const select = $('imageProviderSelect');
        select.innerHTML = '';
        state.imageProviders.forEach((provider) => {
            const option = document.createElement('option');
            option.value = provider.id;
            option.textContent = provider.name || provider.id;
            select.appendChild(option);
        });
        const preferred = state.imageProviders.find((item) => item.id === state.imageProviderId)
            || state.imageProviders.find((item) => item.primary)
            || state.imageProviders[0];
        state.imageProviderId = preferred ? preferred.id : '';
        if (preferred) select.value = preferred.id;
        renderImageModels();
        renderImageOptions();
        updateCastImageStatus();
    }

    function renderImageModels() {
        const provider = state.imageProviders.find((item) => item.id === state.imageProviderId);
        const models = (provider && provider.image_models) || [];
        const labels = (provider && provider.model_names) || {};
        const select = $('imageModelSelect');
        select.innerHTML = '';
        models.forEach((name) => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = labels[name] || name;
            select.appendChild(option);
        });
        state.imageModel = models[0] || '';
        if (state.imageModel) select.value = state.imageModel;
        select.disabled = models.length === 0;
    }

    function renderImageOptions() {
        const engineSelect = $('castImageEngineSelect');
        engineSelect.innerHTML = '';
        [['online', tr('script.imageEngineOnline')], ['comfy', tr('script.imageEngineComfy')]].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            engineSelect.appendChild(option);
        });
        engineSelect.value = state.imageEngine;

        const ratioSelect = $('imageRatioSelect');
        ratioSelect.innerHTML = '';
        IMAGE_RATIO_ORDER.forEach((value) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            ratioSelect.appendChild(option);
        });
        ratioSelect.value = state.imageRatio;

        const resolutionSelect = $('imageResolutionSelect');
        resolutionSelect.innerHTML = '';
        IMAGE_RESOLUTIONS.forEach((value) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value.toUpperCase();
            resolutionSelect.appendChild(option);
        });
        resolutionSelect.value = state.imageResolution;
        renderCastImageEngine();
    }

    // 人物 / 场景 / 道具各自的工作流选择：「人物」走 生角色 → 人物三视图 这条链，
    // 「场景」走生场景那套，两者互不顶掉，所以按类型各记一份（旧的单选值会迁到三类上）。
    const CAST_COMFY_KINDS = ['character', 'scene', 'prop'];
    const CAST_COMFY_WORKFLOW_KEY = 'studio_script_cast_comfy_workflow_v2';
    const CAST_COMFY_WORKFLOW_OLD_KEY = 'studio_script_cast_comfy_workflow';
    const CAST_COMFY_SELECT_ID = {
        character: 'castComfyWorkflowSelect',
        scene: 'castSceneComfyWorkflowSelect',
        prop: 'castPropComfyWorkflowSelect',
    };

    function castComfyWorkflowName(kind) {
        const key = CAST_COMFY_KINDS.includes(kind) ? kind : 'character';
        return (state.castComfyWorkflowByKind || {})[key] || '';
    }

    function saveCastComfyWorkflows() {
        try {
            localStorage.setItem(CAST_COMFY_WORKFLOW_KEY, JSON.stringify(state.castComfyWorkflowByKind || {}));
        } catch (error) { /* 隐私模式或超配额时静默跳过 */ }
        saveCastState();
    }

    // 在线生图和 ComfyUI 工作流的平台配置不同；比例与分辨率两种引擎都要，始终显示
    function renderCastImageEngine() {
        const comfy = state.imageEngine === 'comfy';
        ['imageProviderSelect', 'imageModelSelect'].forEach((id) => {
            $(id).hidden = comfy;
        });
        CAST_COMFY_KINDS.forEach((kind) => {
            const select = $(CAST_COMFY_SELECT_ID[kind]);
            if (select) select.hidden = !comfy;
        });
    }

    // 工作流能不能配画幅要等拿到它的 JSON 才知道，null 表示还没探到，此时不做任何提示。
    // 三类各有一个工作流：只要有任意一个不支持配画幅，就按「不支持」提示。
    async function refreshCastSizeSupport() {
        state.castComfySizeReady = null;
        const names = CAST_COMFY_KINDS.map(castComfyWorkflowName).filter(Boolean);
        if (!names.length) {
            updateCastImageStatus();
            return;
        }
        try {
            const support = await Promise.all(names.map(async (name) => (
                castComfySupportsSize(await castComfyWorkflowData('', name))
            )));
            state.castComfySizeReady = support.every(Boolean);
        } catch (error) {
            state.castComfySizeReady = null;
        }
        updateCastImageStatus();
    }

    async function loadCastComfyWorkflows() {
        const response = await fetch('/api/workflows');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        state.castComfyWorkflows = data.workflows || [];
        const names = state.castComfyWorkflows.map((item) => item.name);
        // 旧的单选值（一个全局工作流）迁到三类上，用户之前选的工作流不丢
        let saved = {};
        try {
            saved = JSON.parse(localStorage.getItem(CAST_COMFY_WORKFLOW_KEY) || 'null') || {};
        } catch (error) {
            saved = {};
        }
        const legacy = localStorage.getItem(CAST_COMFY_WORKFLOW_OLD_KEY) || '';
        const fallback = names.includes(DEFAULT_CAST_COMFY_WORKFLOW) ? DEFAULT_CAST_COMFY_WORKFLOW : (names[0] || '');
        const remembered = {};
        CAST_COMFY_KINDS.forEach((kind) => {
            const want = String(saved[kind] || '').trim() || legacy;
            remembered[kind] = names.includes(want) ? want : fallback;
        });
        state.castComfyWorkflowByKind = remembered;
        CAST_COMFY_KINDS.forEach((kind) => {
            const select = $(CAST_COMFY_SELECT_ID[kind]);
            if (!select) return;
            select.innerHTML = '';
            state.castComfyWorkflows.forEach((item) => {
                const option = document.createElement('option');
                option.value = item.name;
                option.textContent = item.title || item.name;
                select.appendChild(option);
            });
            select.value = remembered[kind] || '';
            select.disabled = !remembered[kind];
        });
        saveCastComfyWorkflows();
        await refreshCastSizeSupport();
    }

    function castSectionKind(text) {
        if (/道具|物件|prop/i.test(text)) return 'prop';
        if (/场景|环境|scene/i.test(text)) return 'scene';
        if (/人物|角色|character|cast/i.test(text)) return 'character';
        return '';
    }

    // 标题后面常常跟着生成规格：「江砚 · 三视图提示词」「末班车车厢 · 概念图」
    // 「黑铁峡矿场全景（夜）——概念图」。这些后缀不是条目名的一部分，去掉，
    // 免得条目名、卡片上的「关联素材」、入库后的素材名都带着一串规格词。
    const CAST_SPEC_WORDS = '三视图提示词|角色提示词|场景提示词|人物提示词|道具提示词|道具档案图|多角度档案图|状态变体|道具设定图|道具微距图|道具实景图|道具图|提示词|概念图|气氛图|名场面图|设定图|参考图';
    const CAST_SPEC_SUFFIX_RE = new RegExp(`\\s*(?:[·•|｜]\\s*|—{2,}\\s*)(?:${CAST_SPEC_WORDS})\\s*$`);
    // 「（概念图）」这种整段就是规格词时，是规格标注而不是中英别名
    const CAST_SPEC_WORD_RE = new RegExp(`^(?:${CAST_SPEC_WORDS})$`);

    // 去掉「（版式 B · 并排三视图…）」这类规格说明，只留条目名
    function castItemTitle(text) {
        // 「### 1. 秦烬」这种带序号的标题，序号不属于名字：留着会让匹配键变成 "1秦烬"，
        // 只有分镜里恰好写成 <Subject1>秦烬 时才歪打正着。先去序号再取名字。
        const name = String(text || '')
            .replace(/^[ \t]*\d+[ \t]*[.、)）][ \t]*/, '')
            .replace(/[（(][^）)]*[）)]\s*$/, '')
            .trim();
        return name.replace(CAST_SPEC_SUFFIX_RE, '').trim() || name;
    }

    // 「人物清单 / 场景清单」的项目符号里常把中英写法并列写好：
    //   - 江砚（Jiang Yan）——档案室职员…
    //   - **林砚（Lin Yan）**——十六岁…
    // 分镜提示词里往往只用其中一种写法（比如整段用英文 Jiang Yan），别名得认。
    function parseCastAliases(markdown) {
        const map = {};
        String(markdown || '').split('\n').forEach((raw) => {
            const line = raw.trim();
            if (!/^[-*]\s/.test(line)) return;
            const found = /^[-*]\s*\**\s*([^（(—\-*]+?)\s*[（(]\s*([^）)]+)\s*[）)]/.exec(line);
            if (!found) return;
            const name = found[1].trim();
            const alias = found[2].trim();
            if (!name || !alias || CAST_SPEC_WORD_RE.test(alias)) return;
            const key = normalizeRefName(name);
            if (!key) return;
            if (!map[key]) map[key] = [];
            if (!map[key].includes(alias)) map[key].push(alias);
        });
        return map;
    }

    // 「人物清单 / 场景清单」两段 Markdown：标题取 ### 行，提示词取该标题下的代码块。
    // 有的模型把正向提示词和 negative 拆成两个块，这里合并回同一条，保证一个条目只出一张卡片。
    // forcedKind：提示词已经拆到「人物」「场景」两个框里时，整段都按这个类型算，不再靠标题猜。
    function parseCastItems(markdown, forcedKind) {
        const items = { character: [], scene: [], prop: [] };
        let kind = forcedKind || '';
        let sectionTitle = '';
        let title = '';
        let inFence = false;
        let buffer = [];
        let prompts = [];
        const flush = () => {
            const prompt = prompts.join('\n').trim();
            prompts = [];
            if (!prompt || !kind) return;
            items[kind].push({ kind, title: title || sectionTitle || kind, prompt });
        };
        String(markdown || '').split('\n').forEach((raw) => {
            const line = raw.trimEnd();
            if (line.trim().startsWith('```')) {
                if (inFence) {
                    inFence = false;
                    const prompt = buffer.join('\n').trim();
                    buffer = [];
                    if (prompt) prompts.push(prompt);
                } else {
                    inFence = true;
                    buffer = [];
                }
                return;
            }
            if (inFence) {
                buffer.push(line);
                return;
            }
            const heading = /^(#{2,4})\s+(.+?)\s*$/.exec(line);
            if (!heading) return;
            flush();
            if (heading[1].length === 2) {
                if (!forcedKind) kind = castSectionKind(heading[2]);
                sectionTitle = castItemTitle(heading[2]);
                title = '';
            } else if (kind) {
                title = castItemTitle(heading[2]);
            }
        });
        flush();
        return items;
    }

    function castEntriesOfKind(kind) {
        return (state.castItems[kind] || []).map((item, index) => ({ item, index }));
    }

    // 人物、场景和道具的提示词各放一个框、各存各的，合成一份时才拼起来（分镜要的是完整设定）
    function castText(kind) {
        if (kind === 'scene') return $('castScenes').value;
        if (kind === 'prop') return $('castProps').value;
        return $('castCharacters').value;
    }

    function castAllText() {
        return [castText('character'), castText('scene'), castText('prop')]
            .map((text) => String(text || '').trim())
            .filter(Boolean)
            .join('\n\n');
    }

    function setCastText(characters, scenes, props) {
        $('castCharacters').value = String(characters || '');
        $('castScenes').value = String(scenes || '');
        $('castProps').value = String(props || '');
    }

    // 老数据里人物、场景和道具是挤在同一段 Markdown 里的，按二级标题把它切回三个框
    function splitCastMarkdown(markdown) {
        const buckets = { character: [], scene: [], prop: [] };
        let kind = '';
        String(markdown || '').split('\n').forEach((line) => {
            const heading = /^(#{2})\s+(.+?)\s*$/.exec(line);
            if (heading) {
                const detected = castSectionKind(heading[2]);
                if (detected) kind = detected;
            }
            if (kind) buckets[kind].push(line);
        });
        return {
            character: buckets.character.join('\n').trim(),
            scene: buckets.scene.join('\n').trim(),
            prop: buckets.prop.join('\n').trim(),
        };
    }

    function allCastEntries() {
        return ['character', 'scene', 'prop'].flatMap(castEntriesOfKind);
    }

    function castShotKey(item, index) {
        return `${item.kind}:${index}`;
    }

    // 提示词被改过之后旧图就不再对应当前设定，直接作废重来
    function castShotOf(item, index) {
        const shot = state.castShots[castShotKey(item, index)];
        return shot && shot.prompt === item.prompt ? shot : null;
    }

    function findCastEntry(key) {
        return allCastEntries().find(({ item, index }) => castShotKey(item, index) === key) || null;
    }

    // 去掉空白和标点后再比：分镜提示词里出现的名字可能带标点或空格变体
    function normalizeRefName(text) {
        return String(text || '').replace(/[\s·、，,。.：:；;！!？?（）()【】\[\]「」『』<>《》\-—_/\\'"]/g, '').toLowerCase();
    }

    // 条目标题常写成「林砚 · Lin Yan」这种中英并列，整名几乎不会原样出现在分镜文本里，
    // 按标点拆成别名逐个比。中文别名 2 字起；纯拉丁别名要 4 字起，否则 "Su" 这种会到处误命中。
    // declared=true 的是「人物清单」里明写出来的别名（- 包（Bao）），是作者自己起的名字，
    // 拉丁字母 3 字也认（Bao），不然单字中文名（包）永远匹配不上。
    // 分镜 / 素材标题里常见的通用后缀（是「作品类型」，不是名字），拆别名时要丢掉
    const CAST_GENERIC_LABEL_RE = /^(人物三视图|三视图|人物设定|概念图|场景图|道具图|氛围图|名场面图|状态变体|档案图|道具档案图|多角度档案图)$/;

    function castNameKeys(title) {
        const keys = new Set();
        const add = (raw, declared) => {
            const key = normalizeRefName(raw);
            if (!key) return;
            const cjk = (key.match(/[\u4e00-\u9fa5]/g) || []).length;
            if (cjk ? key.length >= 2 : key.length >= (declared ? 3 : 4)) keys.add(key);
        };
        add(title);
        String(title || '').split(/[·•|｜/／、（）()【】\[\]「」『』]+/).forEach((part) => {
            // 「人物三视图 / 概念图」这类是标题里的通用后缀，不是名字：留着会变成人人都有、
            // 又到处出现的键，把根本没出场的素材也匹配上
            if (CAST_GENERIC_LABEL_RE.test(String(part || '').trim())) return;
            add(part);
        });
        // 清单里给的中英别名：分镜提示词里写英文时，靠它才认得出这个条目
        (state.castAliases[normalizeRefName(title)] || []).forEach((alias) => add(alias, true));
        return [...keys];
    }

    // 按类型 + 名字找回清单里的条目：名字写得跟条目标题不完全一样也认
    //（去标点后相等，或一方包含另一方），供 PenShot 片段的显式引用绑定用。
    function castEntriesMatchingName(kind, name) {
        const target = normalizeRefName(name);
        if (!target) return [];
        return castEntriesOfKind(kind).filter(({ item }) => {
            const keys = castNameKeys(item.title);
            return keys.some((key) => key === target || target.includes(key) || key.includes(target));
        });
    }

    // 这个分镜里提到的人物 / 场景：拿上面人物与场景的条目名在单元文字里做包含匹配，
    // 命中即视为「用了这份素材」，卡片上把对应的本地图片带出来。
    // PenShot「采用」过来的片段另外带一份显式引用（unit.refNames）——它的提示词是英中双语，
    // 未必逐字包含条目名，靠这份引用才不会漏掉场景图 / 人物图。
    function castRefsOfUnit(unit) {
        // 带显式引用（unit.refNames）的单元 —— 技能提取 / PenShot 采用过来的 —— 以引用为准：
        // 那份引用就是「这个镜头用到了谁」，别的一概不算。模型经常把整张人物清单写进头部
        // `<Subject…>` 行，靠扫全文判断的话没出场的角色也会被关联上、参考图还会被接进工作流。
        const refNames = (unit.refNames || []).filter((ref) => ref && ref.name);
        if (refNames.length) {
            const keys = new Set();
            refNames.forEach(({ kind, name }) => {
                castEntriesMatchingName(kind, name).forEach(({ item }) => {
                    castNameKeys(item.title).forEach((key) => keys.add(key));
                });
            });
            // 人物额外认一份「正文里点名」的：新出图的角色靠它才接得进已生成的分镜，
            // 不必重跑提取。只看正文（去掉 <Subject…> 那排声明），不然头部一带就是一整张清单。
            const bodyText = normalizeRefName(
                String(unitText(unit) || '').split('\n').filter((line) => !/^\s*<\s*Subject/i.test(line)).join(' '),
            );
            return allCastEntries().filter(({ item }) => {
                const itemKeys = castNameKeys(item.title);
                if (itemKeys.some((key) => keys.has(key))) return true;
                if (item.kind !== 'character' || !bodyText) return false;
                // 场景不这样扫：「南市来的？」这种台词会把「南市 · 早市街道」也误关联进来。
                return itemKeys.some((key) => bodyText.includes(key));
            });
        }
        // 老数据（服务端生成的分镜）没有引用，只能按文字扫：unit.raw 是模型原始输出，
        // 里面常整块带上人物清单，所以拿提示词全文 + 标题一起匹配（这是这套功能上线前就有的口径）。
        const text = normalizeRefName([unitText(unit), unit.name, unit.raw].filter(Boolean).join(' '));
        if (!text) return [];
        return allCastEntries().filter(({ item }) => castNameKeys(item.title).some((key) => text.includes(key)));
    }

    function castRunLabel(item, index) {
        const shot = castShotOf(item, index);
        if (!shot) return tr('script.itemGenAsset');
        if (shot.status === 'running') return tr('script.imageRunning');
        if (shot.status === 'failed') return tr('script.imageRetry');
        return tr('script.itemRegenAsset');
    }

    function castShotHtml(item, index) {
        const shot = castShotOf(item, index);
        if (!shot) return `<div class="placeholder">${esc(tr('script.imageIdle'))}</div>`;
        if (shot.status === 'running') return `<div class="placeholder">${esc(tr('script.imageRunning'))}</div>`;
        if (shot.status === 'failed') return `<div class="placeholder failed">${esc(tr('script.failed'))}：${esc(shot.error)}</div>`;
        return `<a href="${esc(shot.url)}" target="_blank" rel="noopener"><img src="${esc(shot.url)}" alt="" loading="lazy"></a>`;
    }

    // 每张结果卡片右边两个按钮：重写这一条的提示词、重画这一条的图
    function castItemHtml(item, index) {
        const key = castShotKey(item, index);
        const shot = castShotOf(item, index);
        const running = Boolean(shot && shot.status === 'running');
        const redoing = castPromptRedo.has(key);
        return `
            <div class="cast-item">
                <div class="cast-item-head">
                    <span class="title" title="${esc(item.title)}">${esc(item.title)}</span>
                    <span class="cast-item-actions">
                        <button class="btn" data-cast-redo-prompt="${esc(key)}"${redoing ? ' disabled' : ''}
                            title="${esc(tr('script.itemRegenPromptHint'))}">${esc(redoing ? tr('script.itemRedoingPrompt') : tr('script.itemRegenPrompt'))}</button>
                        <button class="btn" data-cast-run="${esc(key)}"${running ? ' disabled' : ''}
                            title="${esc(tr('script.itemRegenAssetHint'))}">${esc(castRunLabel(item, index))}</button>
                    </span>
                </div>
                <pre>${esc(item.prompt)}</pre>
                <div class="cast-shot" data-cast-shot="${esc(key)}">${castShotHtml(item, index)}</div>
            </div>
        `;
    }

    function renderCastGallery() {
        const box = $('castGallery');
        const blocks = [['character', tr('script.castCharacters')], ['scene', tr('script.castScenes')], ['prop', tr('script.castProps')]]
            .filter(([kind]) => (state.castItems[kind] || []).length)
            .map(([kind, label]) => {
                // 条目一多整块占满屏，按组折叠；折叠时干脆不渲染卡片，DOM 也省下来
                const collapsed = state.castCollapsed[kind] === true;
                const title = `${esc(label)} · ${state.castItems[kind].length}`;
                return `
                    <div class="cast-group${collapsed ? ' collapsed' : ''}">
                        <button class="cast-group-title" data-cast-toggle="${esc(kind)}" aria-expanded="${collapsed ? 'false' : 'true'}">
                            <span class="cast-caret">${collapsed ? '▸' : '▾'}</span>
                            ${title}
                            <span class="hint">${esc(tr(collapsed ? 'script.expand' : 'script.collapse'))}</span>
                        </button>
                        ${collapsed ? '' : `<div class="cast-grid">${state.castItems[kind].map((item, index) => castItemHtml(item, index)).join('')}</div>`}
                    </div>
                `;
            });
        box.innerHTML = blocks.length ? blocks.join('') : `<div class="empty-hint">${esc(tr('script.castGalleryEmpty'))}</div>`;
        syncCastAllButtons();
    }

    // 没有对应条目时按钮点不动，免得点了只弹一句提示
    function syncCastAllButtons() {
        $('castCharacterAllBtn').disabled = !(state.castItems.character || []).length;
        $('castSceneAllBtn').disabled = !(state.castItems.scene || []).length;
        $('castPropAllBtn').disabled = !(state.castItems.prop || []).length;
    }

    function syncCastGallery() {
        state.castItems = {
            character: parseCastItems($('castCharacters').value, 'character').character,
            scene: parseCastItems($('castScenes').value, 'scene').scene,
            prop: parseCastItems($('castProps').value, 'prop').prop,
        };
        // 清单里声明的中英别名，匹配分镜提示词时要一起用（提示词里常只写英文名）
        state.castAliases = Object.assign(
            {},
            parseCastAliases($('castCharacters').value),
            parseCastAliases($('castScenes').value),
            parseCastAliases($('castProps').value),
        );
        renderCastGallery();
        updateCastImageStatus();
        saveCastState();
        // 人物 / 场景 / 道具条目变了，分镜卡片上的关联素材也要跟着重算
        refreshUnitRefs();
        // 恢复出来的旧图还没进素材库的，这时候补上
        saveMissingCastShots();
        syncCastCheckBtn();
    }

    // ---------- 检查漏掉的条目（只新增，不改已有） ----------
    // 把「已生成分镜」里出现的实体声明抽成一段摘要，交给模型对照清单找漏。
    // 只挑 `<Subject…>` 开头的行（`<Subject1>Lu Ye是<Picture 1>…`、`<Subject 2>是觉醒广场场景。`），
    // 并按前缀去重 —— 一百多个单元全量发过去太大，去重后一般只剩几十行。
    function storyboardDigest() {
        const lines = [];
        const seen = new Set();
        allUnits().forEach((unit) => {
            String(unit.prompt || '').split('\n').forEach((raw) => {
                const line = raw.trim();
                if (!/^<\s*Subject/i.test(line)) return;
                const key = line.slice(0, 80);
                if (seen.has(key)) return;
                seen.add(key);
                lines.push(`${unit.name || ''}: ${line}`);
            });
        });
        return lines.join('\n');
    }

    // 把模型返回的某一类片段并进对应的文本框：**只插入，不改写**。
    //   1) 项目符号行（- **中文（English）**——身份）插进该框自己的 `## …清单` 段，接在最后一个 bullet 之后；
    //   2) `### 标题` + 代码块整段原文追加到文本框末尾；
    //   3) 标题已经存在的块整块丢弃（连同它的 bullet），绝不重复登记。
    function mergeCastGap(kind, fragment) {
        const area = $(CAST_TEXTAREA_ID[kind]);
        const text = String(fragment || '').trim();
        if (!area || !text) return { count: 0, titles: [], entries: [] };

        // 已有条目的「名字键」。条目标题常写成「秦烬 · Qin Jin」这种中英并列，
        // 光比整个标题会把已经登记过的角色当成新条目重复追加，必须用同一套别名键去比。
        const have = new Set();
        parseCastItems(area.value, kind)[kind].forEach((item) => {
            castNameKeys(item.title).forEach((key) => have.add(key));
        });

        const lines = text.split('\n');
        // bullet 行按「模型只输出新增条目」来算，整段照收
        const bullets = lines.filter((line) => /^[-*]\s+\S/.test(line.trim())).map((line) => line.trimEnd());
        // `###` 块区：从第一个三级/四级标题起，到片段末尾，保留原文
        const start = lines.findIndex((line) => /^#{3,4}\s+/.test(line));
        const blocks = [];
        if (start >= 0) {
            let current = null;
            lines.slice(start).forEach((line) => {
                const heading = /^#{3,4}\s+(.+?)\s*$/.exec(line);
                if (heading) {
                    const title = castItemTitle(heading[1]);
                    current = { title, lines: [line] };
                    blocks.push(current);
                } else if (current) {
                    current.lines.push(line);
                }
            });
        }
        const keep = blocks.filter((block) => {
            const keys = castNameKeys(block.title);
            return keys.length && !keys.some((key) => have.has(key));
        });
        if (!keep.length) return { count: 0, titles: [], entries: [] };

        const keepKeys = new Set();
        keep.forEach((block) => castNameKeys(block.title).forEach((key) => keepKeys.add(key)));
        // bullet 只留名字对得上的那些，模型偶尔会多写一条已有条目的行
        const freshBullets = bullets.filter((line) => {
            const found = /^[-*]\s*\**\s*([^（(—\-*]+?)\s*[（(]\s*([^）)]+)\s*[）)]/.exec(line.trim());
            if (!found) return true;
            return keepKeys.has(normalizeRefName(found[1].trim())) || keepKeys.has(normalizeRefName(found[2].trim()));
        });

        const lines2 = area.value.split('\n');
        if (freshBullets.length) {
            const sectionAt = lines2.findIndex((line) => {
                const heading = /^(#{2})\s+(.+?)\s*$/.exec(line);
                return heading && castSectionKind(heading[2]) === kind;
            });
            // 该段里最后一个 bullet 的位置；段在下一个二级/三级标题处结束
            // （`### 条目` 块紧跟在清单之后，别把块里可能出现的 `- ` 行当成 bullet）
            let insertAt = sectionAt >= 0 ? sectionAt + 1 : 0;
            if (sectionAt >= 0) {
                for (let i = sectionAt + 1; i < lines2.length; i += 1) {
                    if (/^#{2,4}\s+/.test(lines2[i])) break;
                    if (/^[-*]\s+\S/.test(lines2[i].trim())) insertAt = i + 1;
                }
            }
            lines2.splice(insertAt, 0, ...freshBullets);
            area.value = lines2.join('\n');
        }

        const blockText = keep.map((block) => block.lines.join('\n').trim()).join('\n\n');
        area.value = `${area.value.replace(/\s+$/, '')}\n\n${blockText}\n`;

        const entries = [];
        keep.forEach((block) => entries.push({ kind, title: block.title }));
        return { count: keep.length, titles: keep.map((block) => block.title), entries };
    }

    // 模型返回是一整份 Markdown 片段，按二级标题切回人物/场景/道具三个框
    function mergeMissingCast(markdown) {
        const raw = String(markdown || '');
        let parts = splitCastMarkdown(raw);
        // 模型偶尔把 `## 人物清单` 这行二级标题漏了，只给 `###` 块：退回按标题里的类型词归类
        if (!parts.character && !parts.scene && !parts.prop) {
            const buckets = { character: [], scene: [], prop: [] };
            let kind = '';
            raw.split('\n').forEach((line) => {
                const heading = /^#{2,4}\s+(.+?)\s*$/.exec(line);
                if (heading) {
                    const guessed = castSectionKind(heading[1]);
                    if (guessed) {
                        kind = guessed;
                        buckets[kind].push(`### ${heading[1]}`);
                        return;
                    }
                }
                if (kind) buckets[kind].push(line);
            });
            parts = {
                character: buckets.character.join('\n').trim(),
                scene: buckets.scene.join('\n').trim(),
                prop: buckets.prop.join('\n').trim(),
            };
        }
        const result = { total: 0, names: [], entries: [] };
        const before = {};
        CAST_KINDS.forEach((kind) => { before[kind] = castEntriesOfKind(kind).length; });
        CAST_KINDS.forEach((kind) => {
            const merged = mergeCastGap(kind, parts[kind]);
            result.total += merged.count;
            result.names.push(...merged.titles);
            merged.entries.forEach((entry, offset) => {
                result.entries.push({ kind, index: before[kind] + offset, title: entry.title });
            });
        });
        if (result.total) syncCastGallery();
        return result;
    }

    // 只给这次补进来的新条目出图：老条目碰都不碰（老条目的图必须原样留着）
    function drawMissingCastAssets(entries) {
        const list = (entries || []).filter((entry) => entry.kind);
        if (!list.length) return;
        if (!castImageReady()) return;
        const pending = list.map((entry) => ({
            kind: entry.kind,
            item: (state.castItems[entry.kind] || [])[entry.index],
            index: entry.index,
        })).filter((entry) => entry.item);
        if (pending.length) runCastShots(pending);
    }

    // 只刷新单条，避免轮询期间整块重绘打断已出的图
    function refreshCastItem(item, index) {
        const key = castShotKey(item, index);
        const slot = document.querySelector(`[data-cast-shot="${key}"]`);
        if (slot) slot.innerHTML = castShotHtml(item, index);
        const button = document.querySelector(`[data-cast-run="${key}"]`);
        if (button) {
            const shot = castShotOf(item, index);
            button.textContent = castRunLabel(item, index);
            button.disabled = Boolean(shot && shot.status === 'running');
        }
        // 这张图生成好了，分镜卡片上引用到它的缩略图也跟着换出来
        refreshUnitRefs();
    }

    // 比例 × 分辨率档位 → 实际像素，在线生图和 ComfyUI 工作流共用同一套换算
    function castImageSize() {
        const ratio = state.imageRatio || IMAGE_RATIO_ORDER[0];
        const sizes = IMAGE_RATIO_SIZES[ratio] || IMAGE_RATIO_SIZES['1:1'];
        const level = Math.max(0, IMAGE_RESOLUTIONS.indexOf(state.imageResolution));
        return sizes[Math.min(level, sizes.length - 1)];
    }

    function castImageParams(item) {
        return {
            prompt: item.prompt,
            provider_id: state.imageProviderId,
            model: state.imageModel,
            size: castImageSize(),
            aspect_ratio: state.imageRatio || IMAGE_RATIO_ORDER[0],
            resolution: state.imageResolution,
            reference_images: [],
        };
    }

    // ComfyUI 工作流的画幅有两种写法：config 里手工映射的宽高字段，以及生成节点
    // （EmptyLatentImage 系列）上的 width/height 字面量。前者优先，都没有就沿用工作流自带尺寸。
    const COMFY_SIZE_FIELD_RE = /^(width|height|w|h)$/i;
    const COMFY_SIZE_NODE_RE = /^empty.*latent.*image/i;

    function comfySizeFields(fields) {
        return (fields || []).filter((field) => (
            field.node && field.input && COMFY_SIZE_FIELD_RE.test(String(field.input).trim())
        ));
    }

    function comfyLatentSizeNodes(workflow) {
        return Object.keys(workflow || {}).filter((nodeId) => (
            COMFY_SIZE_NODE_RE.test(String((workflow[nodeId] || {}).class_type || ''))
        ));
    }

    function castComfySupportsSize(data) {
        return Boolean(
            comfySizeFields(data && data.config && data.config.fields).length
            || comfyLatentSizeNodes(data && data.workflow).length
        );
    }

    function applyCastSizeToComfy(params, data, size) {
        const [width, height] = String(size || '').split('x').map(Number);
        if (!Number.isFinite(width) || !Number.isFinite(height)) return;
        const fields = comfySizeFields(data && data.config && data.config.fields);
        if (fields.length) {
            fields.forEach((field) => {
                params[field.node] = params[field.node] || {};
                params[field.node][field.input] = /^h/i.test(String(field.input).trim()) ? height : width;
            });
            return;
        }
        comfyLatentSizeNodes(data && data.workflow).forEach((nodeId) => {
            params[nodeId] = params[nodeId] || {};
            params[nodeId].width = width;
            params[nodeId].height = height;
        });
    }

    // 工作流里除画幅之外的参数（步数、采样器等）一律沿用配置里的默认值，
    // 这里只负责把卡片的提示词写进承载提示词的输入。
    function castComfyPromptFields(fields) {
        return (fields || []).filter((field) => (
            field.node && field.input && (comfyFieldKind(field) === 'prompt' || field.builtin_prompt === true)
        ));
    }

    async function castComfyWorkflowData(kind, nameOverride) {
        const name = String(nameOverride || '').trim() || castComfyWorkflowName(kind);
        if (!name) return null;
        if (state.castComfyCache[name]) return state.castComfyCache[name];
        const response = await fetch(`/api/workflows/${encodeURIComponent(name)}`);
        if (!response.ok) throw new Error(await errorMessage(response));
        const data = await response.json();
        state.castComfyCache[name] = data;
        return data;
    }

    async function pollCastTask(path, pickUrl) {
        for (;;) {
            if (state.imageAbort) throw new Error(tr('script.imageStopped'));
            await sleep(CAST_IMAGE_POLL_MS);
            const poll = await fetch(path);
            if (!poll.ok) throw new Error(await errorMessage(poll));
            const data = await poll.json();
            if (data.status === 'succeeded') {
                const url = pickUrl(data.result || {});
                if (!url) throw new Error(tr('script.imageNoOutput'));
                return url;
            }
            if (data.status === 'failed') throw new Error(data.error || tr('script.failed'));
        }
    }

    async function runCastOnlineShot(item) {
        const created = await fetch('/api/canvas-image-tasks', {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify(castImageParams(item)),
        });
        if (!created.ok) throw new Error(await errorMessage(created));
        const task = await created.json();
        if (!task.task_id) throw new Error(tr('script.failed'));
        return pollCastTask(`/api/canvas-image-tasks/${encodeURIComponent(task.task_id)}`, (result) => {
            const media = (result.image_items || [])[0] || {};
            return media.url || (result.images || [])[0] || '';
        });
    }

    // 一份工作流跑一遍：按配置填字段（提示词 / 数值 / 画幅），refImageUrl 给了就把它当参考图喂进去，
    // 返回成图地址。人物那条链的两道工序都走这里。
    async function runCastComfyOnce(kind, data, item, refImageUrl, name) {
        const workflowName = String(name || '').trim() || castComfyWorkflowName(kind);
        const fields = (data.config && data.config.fields) || [];
        const promptFields = castComfyPromptFields(fields);
        if (!promptFields.length) throw new Error(tr('script.imageNoWorkflowPrompt'));
        const promptIds = new Set(promptFields.map((field) => field.id));
        const params = {};
        fields.forEach((field) => {
            if (!field.node || !field.input || promptIds.has(field.id)) return;
            if (['image', 'video', 'audio'].includes(comfyFieldKind(field))) return;
            params[field.node] = params[field.node] || {};
            params[field.node][field.input] = field.default;
        });
        promptFields.forEach((field) => {
            params[field.node] = params[field.node] || {};
            params[field.node][field.input] = item.prompt;
        });
        // 参考图（上一道工序的成图）：上传后写进这份工作流自己的图片输入节点
        if (refImageUrl) {
            await attachCastRefImage(params, (data.config || {}).fields || [], data.workflow || {}, refImageUrl);
        }
        // 画幅最后写，覆盖掉工作流里自带的宽高默认值
        applyCastSizeToComfy(params, data, castImageSize());

        const created = await fetch('/api/canvas-comfy-tasks', {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify({
                prompt: item.prompt,
                workflow_json: workflowName,
                params,
                type: 'script-studio',
                client_id: '',
            }),
        });
        if (!created.ok) throw new Error(await errorMessage(created));
        const task = await created.json();
        if (!task.task_id) throw new Error(tr('script.failed'));
        return pollCastTask(`/api/canvas-comfy-tasks/${encodeURIComponent(task.task_id)}`, (result) => {
            const media = mediaFromResult(result);
            const first = media.find((entry) => !entry.kind || entry.kind === 'image') || media[0] || {};
            return first.url || '';
        });
    }

    // 工作流里某个节点是什么类型：优先看工作流 JSON，再看已经写好的参数
    function workflowNodeClass(workflow, params, nodeId) {
        const id = nodeId == null ? null : String(nodeId);
        return String(
            ((workflow || {})[id] || {}).class_type
            || ((params || {})[id] || {}).class_type
            || '',
        );
    }

    // 把参考图写进这份工作流声明的图片输入：目标是 LoadImage 就换它的图片文件名，
    // 目标和它连着的槽位一起清掉，免得工作流自带的占位图混进来
    async function attachCastRefImage(params, fields, workflow, refImageUrl) {
        const field = (fields || []).find((item) => (
            comfyFieldKind(item) === 'image' && comfyFieldTargets(item).length
        ));
        if (!field) return false;
        const name = await uploadComfyRefUrl(refImageUrl);
        if (!name) return false;
        const targets = comfyFieldTargets(field);
        const slots = targets.filter((node) => workflowNodeClass(workflow, params, node) === 'LoadImage');
        if (slots.length) {
            const spare = new Set(slots.slice(1));
            if (spare.size) {
                Object.keys(workflow || {}).forEach((id) => {
                    const inputs = ((workflow || {})[id] || {}).inputs || {};
                    Object.keys(inputs).forEach((key) => {
                        const source = Array.isArray(inputs[key]) ? String(inputs[key][0]) : '';
                        if (!source || !spare.has(source)) return;
                        params[id] = params[id] || {};
                        params[id][key] = null;
                    });
                });
            }
            params[slots[0]] = { ...(params[slots[0]] || {}), inputs: { ...((params[slots[0]] || {}).inputs || {}), image: name } };
            return true;
        }
        const input = String(field.input || '').trim();
        if (!input) return false;
        targets.forEach((node) => {
            params[node] = params[node] || {};
            params[node][input] = null;
        });
        const usedIds = new Set([...Object.keys(params), ...Object.keys(workflow || {})]);
        let seq = 950000;
        while (usedIds.has(String(seq))) seq += 1;
        params[String(seq)] = { class_type: 'LoadImage', inputs: { image: name } };
        params[targets[0]][`${input}.${String(field.prefix || '').trim() || 'image_'}0`] = [String(seq), 0];
        return true;
    }

    async function runCastComfyShot(item) {
        const kind = item.kind || 'character';
        const data = await castComfyWorkflowData(kind);
        if (!data) throw new Error(tr('script.imageNoWorkflow'));
        const config = data.config || {};
        const chain = String(config.chain_from || '').trim();
        // 这条链（生角色 → 人物三视图）：先用同一段素材提示词跑上游出图，再把成图当本工作流的参考图
        let refImageUrl = '';
        if (chain && castChainApplies(config, kind)) {
            const upstream = await castComfyWorkflowData(kind, chain).catch(() => null);
            if (upstream) {
                refImageUrl = await runCastComfyOnce(kind, upstream, item, '', chain);
            }
        }
        return runCastComfyOnce(kind, data, item, refImageUrl, castComfyWorkflowName(kind));
    }

    // chain_from 默认对三类都生效；配了 chain_kinds 就只对列出的类型生效
    //（人物那条链只该用在「人物」条目上，场景/道具照旧走自己的工作流）
    function castChainApplies(config, kind) {
        const kinds = config.chain_kinds;
        if (Array.isArray(kinds) && kinds.length) return kinds.includes(kind);
        return true;
    }

    async function submitCastShot(item, index) {
        const key = castShotKey(item, index);
        // 这张参考图之前有没有出过：第一次出图时，已经在分镜里用到它的单元要重跑一遍
        const before = state.castShots[key];
        const hadImage = Boolean(before && before.status === 'done' && before.url);
        state.castShots[key] = { status: 'running', prompt: item.prompt, url: '', error: '' };
        refreshCastItem(item, index);
        const url = state.imageEngine === 'comfy'
            ? await runCastComfyShot(item)
            : await runCastOnlineShot(item);
        state.castShots[key] = { status: 'done', prompt: item.prompt, url, error: '' };
        refreshCastItem(item, index);
        saveCastState();
        saveCastShotToLibrary(item, index);
        // 这份素材第一次有图了：用到了它的分镜，旧成片标记成需要重新生成
        if (!hadImage) syncUnitsForRefItems([item]);
    }

    // 出图后自动把这张参考图存进素材库：人物进「角色」分组、场景进「场景」分组。
    // 存没存过记在这张图的记录上（跟着参考图状态一起落盘），刷新页面不会重复入库；
    // inFlight 挡的是「还在存的时候又被触发一次」这种同图存两遍。
    const castLibraryInFlight = new Set();

    async function saveCastShotToLibrary(item, index) {
        const key = castShotKey(item, index);
        const shot = state.castShots[key];
        if (!shot || shot.status !== 'done' || !shot.url || shot.inLibrary || castLibraryInFlight.has(key)) return;
        castLibraryInFlight.add(key);
        try {
            const response = await fetch('/api/script/save-media-to-library', {
                method: 'POST',
                headers: jsonHeaders,
                body: JSON.stringify({ url: shot.url, name: item.title, kind: item.kind, library_id: scriptAssetLibraryId }),
            });
            if (!response.ok) throw new Error(await errorMessage(response));
            shot.inLibrary = true;
            saveCastState();
        } catch (error) {
            // 素材库没存上不该影响出图，提示一声就过去
            toast(tf('script.librarySaveFailed', { name: item.title, detail: String(error.message || error) }));
        } finally {
            castLibraryInFlight.delete(key);
        }
    }

    // 早先生成好、还没进过素材库的图，进入页面时一并补存
    function saveMissingCastShots() {
        allCastEntries().forEach(({ item, index }) => { saveCastShotToLibrary(item, index); });
    }

    // 生图任务池：人物、场景两个「全部生成」共用它。一批跑起来之后再点另一个按钮，
    // 那一组的条目会追加进同一批（不打断手里这批），并发上限和「停止」也是共用的
    // —— 之前是一批在跑就把两个按钮都藏起来，另一组只能等它跑完。
    const castPool = { queue: [], cursor: 0, active: 0, queued: new Set() };

    // 这一批同时开几条：走 ComfyUI 时有几台能用的就开几条 —— 后端每提交一条都会挑当前最闲的
    // 那台（reserve_best_backend），一条一台正好把配的机器铺满；只按固定条数跑的话，
    // 剩下几台就白配着一直闲。走在线平台时排队是在服务商那边，维持原来的固定并发。
    function castPoolLimit() {
        return state.imageEngine === 'comfy' ? usableHostCount() : CAST_IMAGE_CONCURRENCY;
    }

    function castPoolHas(key) {
        return castPool.queued.has(key);
    }

    // 这一组还有没有活儿：排进池子里等跑的，或者正在跑的
    function castKindBusy(kind) {
        return castEntriesOfKind(kind).some(({ item, index }) => {
            const shot = castShotOf(item, index);
            return castPoolHas(castShotKey(item, index)) || Boolean(shot && shot.status === 'running');
        });
    }

    function runCastShots(entries) {
        // 已经在池里的条目不再重复入队，避免同一张图提交两次
        const append = (list) => list.forEach(({ item, index }) => {
            const key = castShotKey(item, index);
            if (castPoolHas(key)) return;
            castPool.queued.add(key);
            castPool.queue.push({ item, index });
        });
        if (state.imageRunning) {
            // 追加到正在跑的那一批，跑完手上这几条就接着跑新加进来的。
            // 若此刻正好停在半路（点了「停止」但还有几条在跑），这次点击算改主意：撤销停止接着跑。
            state.imageAbort = false;
            append(entries);
            pumpCastPool();
            return;
        }
        if (!entries.length) return;
        if (state.imageEngine === 'comfy') {
            // 这批里每个类型都得有工作流（人物 / 场景各一套，缺哪个就提示哪个）
            const missing = [...new Set(entries.map((entry) => entry.kind))]
                .filter((kind) => kind && !castComfyWorkflowName(kind));
            if (missing.length) {
                toast(tr('script.imageNoWorkflow'));
                return;
            }
        } else if (!state.imageProviderId || !state.imageModel) {
            toast(tr('script.imageNoProvider'));
            return;
        }
        castPool.queue = [];
        castPool.cursor = 0;
        castPool.active = 0;
        castPool.queued = new Set();
        append(entries);
        if (!castPool.queue.length) return;
        state.imageRunning = true;
        state.imageAbort = false;
        setCastImageUI(true);
        updateCastImageStatus();
        // 走 ComfyUI 时先问一次「有几台能用」，免得刚进页面还没探完就按一台串着跑
        if (state.imageEngine === 'comfy') refreshUnitRunLimit();
        pumpCastPool();
    }

    // 按并发上限把队列里的条目派出去；每次有任务收尾都回来补位，
    // 直到池子空下来（此时才算这一批结束）。
    function pumpCastPool() {
        while (!state.imageAbort
            && castPool.active < castPoolLimit()
            && castPool.cursor < castPool.queue.length) {
            const { item, index } = castPool.queue[castPool.cursor];
            castPool.cursor += 1;
            castPool.active += 1;
            submitCastShot(item, index)
                .catch((error) => {
                    const key = castShotKey(item, index);
                    if (state.imageAbort) {
                        // 主动停下来的不算失败：退回「待生成」，下次点还能重跑
                        delete state.castShots[key];
                    } else {
                        state.castShots[key] = {
                            status: 'failed',
                            prompt: item.prompt,
                            url: '',
                            error: String(error.message || error),
                        };
                    }
                    refreshCastItem(item, index);
                    saveCastState();
                })
                .finally(() => {
                    castPool.active -= 1;
                    updateCastImageStatus();
                    pumpCastPool();
                });
        }
    // 停的时候队列里往往还剩没派出去的条目，此时不能等 cursor 追上 queue.length，
    // 否则池子会永远停在「生成中」：停止按钮不隐藏、也再起不了新的一批。
    if (!castPool.active && (state.imageAbort || castPool.cursor >= castPool.queue.length)) finishCastPool();
    }

    function finishCastPool() {
        if (!state.imageRunning) return;
        state.imageRunning = false;
        castPool.queue = [];
        castPool.cursor = 0;
        castPool.queued = new Set();
        setCastImageUI(false);
        updateCastImageStatus();
        if (state.imageAbort) toast(tr('script.imageStopped'));
    }

    // 人物和场景各自一个「全部生成」，只跑自己那一组；
    // 已经出图的不再重跑（提示词改过的旧图会被 castShotOf 判为失效，照样重生成），只补缺的那几条。
    function runCastKind(kind) {
        const all = castEntriesOfKind(kind);
        if (!all.length) {
            toast(tr('script.imageNeedCast'));
            return;
        }
        const pending = all.filter(({ item, index }) => {
            const shot = castShotOf(item, index);
            return (!shot || shot.status !== 'done') && !castPoolHas(castShotKey(item, index));
        });
        if (!pending.length) {
            toast(tr(castKindBusy(kind) ? 'script.imageKindBusy' : 'script.imageAllGenerated'));
            return;
        }
        runCastShots(pending);
    }

    function setCastImageUI(running) {
        // 两个「全部生成」不再跟着隐藏：跑着的时候点另一个，那一组会追加进同一批。
        // 只有一个「停止」，点了随时收手（在跑的那几条会跑完）。
        $('castImageStopBtn').hidden = !running;
        syncCastAllButtons();
    }

    function castImageReady(kind) {
        return state.imageEngine === 'comfy'
            ? Boolean(kind ? castComfyWorkflowName(kind) : CAST_COMFY_KINDS.some((k) => castComfyWorkflowName(k)))
            : Boolean(state.imageProviderId && state.imageModel);
    }

    function updateCastImageStatus(entries) {
        const list = entries || allCastEntries();
        if (!list.length) {
            $('castImageStatus').textContent = '';
            return;
        }
        const shots = list.map(({ item, index }) => castShotOf(item, index)).filter(Boolean);
        const done = shots.filter((shot) => shot.status === 'done').length;
        const failed = shots.filter((shot) => shot.status === 'failed').length;
        if (state.imageRunning) {
            // 走 ComfyUI 时把「几台在并行」一并写出来：配的多台到底用上没用上，一眼能看出来
            const hosts = state.imageEngine === 'comfy' ? castPoolLimit() : 0;
            const progress = hosts > 1
                ? tf('script.imageProgressHosts', { done: done + failed, total: list.length, hosts })
                : tf('script.imageProgress', { done: done + failed, total: list.length });
            $('castImageStatus').textContent = progress;
            return;
        }
        if (!done && !failed) {
            if (!castImageReady()) {
                $('castImageStatus').textContent = tr(state.imageEngine === 'comfy'
                    ? 'script.imageNoWorkflow'
                    : 'script.imageNoProvider');
                return;
            }
            // 工作流里没写画幅的话，比例和分辨率选了也不起作用，提前说清楚
            $('castImageStatus').textContent = state.imageEngine === 'comfy' && state.castComfySizeReady === false
                ? tr('script.imageWorkflowSizeFixed')
                : '';
            return;
        }
        $('castImageStatus').textContent = tf('script.imageSummary', { done, failed, total: list.length });
    }

    // ---------- 生成 ----------
    function setRunningUI(running) {
        $('generateBtn').hidden = running;
        $('stopBtn').hidden = !running;
        // 停在半路时按钮改成「继续生成」，点下去从断点接着跑而不是重头再来
        const key = !running && resumableSession() ? 'script.resume' : 'script.generate';
        const btn = $('generateBtn');
        btn.dataset.i18n = key;
        btn.textContent = tr(key);
    }

    function buildRequestBody() {
        return {
            provider: state.providerId,
            model: state.model,
            ms_model: state.providerId === 'modelscope' ? state.model : '',
            template_id: state.templateId,
            template_text: $('templateText').value.trim(),
            script: scriptContent(),
            notes: $('scriptNotes').value.trim(),
            // 上一步提取出的人物与场景，作为固定设定贯穿所有分镜
            characters: castAllText(),
            // 画风跟着人物/场景走，成片才不会「设定图是动画、正片是真人」
            style_id: state.styleId,
            allow_rewrite: $('allowRewriteInput').checked,
        };
    }

    // 一次请求要把整段剧本的提示词全吐完，剧本长了会撞上 max_tokens 被截断。
    // 按行边界把剧本切成几段分别生成，单元再按原顺序接起来；某段仍被截断就对半切开重跑。
    // 上限按实测调过：1500 字那档仍会撞到上限白跑一遍（推理模型先把额度花在思维链上），
    // 900 字一档能一把过，切得碎一点但省掉了重跑。
    const SEGMENT_MAX_CHARS = 900;
    const SEGMENT_MIN_CHARS = 200;

    function hardSplit(text, size) {
        const out = [];
        for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
        return out;
    }

    function splitScript(text, size) {
        const limit = size || SEGMENT_MAX_CHARS;
        const source = String(text || '').replace(/\r\n/g, '\n').trim();
        if (!source) return [];
        const chunks = [];
        let buffer = '';
        const flush = () => {
            const piece = buffer.trim();
            if (piece) chunks.push(piece);
            buffer = '';
        };
        source.split('\n').forEach((row) => {
            // 尽量断在行边界，免得把一句台词劈成两半
            if (buffer && buffer.length + row.length + 1 > limit) flush();
            buffer += `${row}\n`;
        });
        flush();
        // 整篇没有换行时单行就超长，只能硬切
        return chunks.flatMap((piece) => (piece.length <= limit ? [piece] : hardSplit(piece, limit)));
    }

    // 每段返回的单元编号都从 P01 起，合并后要顺排，否则会冒出好几个 P01
    function renumberUnits(units, offset) {
        return (units || []).map((unit, index) => ({
            ...unit,
            code: `P${String(offset + index + 1).padStart(2, '0')}`,
        }));
    }

    // 已经出过片的分镜按编号收一份。重新生成提示词会把单元整批换成新的，
    // 新单元本身不带成片，收这一份就是为了让它们出现时把成片贴回去 ——
    // 不然刚跑好的视频会因为重写了一遍提示词就在前端消失（还要白白重跑）。
    function collectUnitRuns() {
        const kept = new Map();
        (state.results || []).forEach((item) => {
            ((item && item.units) || []).forEach((unit) => {
                if (!unit.run || !unit.code || kept.has(unit.code)) return;
                kept.set(unit.code, { run: unit.run, runHistory: unit.runHistory || [] });
            });
        });
        return kept;
    }

    // 贴回各自的槽位：只补还没成片的单元，新跑出来的版本不该被旧的顶掉
    function attachUnitRuns(units, kept) {
        if (!kept || !kept.size) return;
        (units || []).forEach((unit) => {
            if (unit.run || !unit.code) return;
            const saved = kept.get(unit.code);
            if (!saved) return;
            unit.run = saved.run;
            if ((saved.runHistory || []).length) unit.runHistory = saved.runHistory;
        });
    }

    // 流式输出时在前端做一次「轻量解析」：和 main.py 的 parse_script_units 同规则，但只取
    // 已经写完的单元（最后一个标题后面的正文可能还在写，先不算），这样模型每写完一段，
    // 分镜卡片就能立刻出现在结果里。
    const LIVE_UNIT_HEADING_RE = /^#{2,4}[ \t]*\**\s*P\s*\d{1,3}\b[^\n]*$/gm;
    const LIVE_FENCE_RE = /```[a-zA-Z]*[ \t]*\n([\s\S]*?)```/g;

    function liveUnitPrompt(body) {
        const blocks = [...String(body || '').matchAll(LIVE_FENCE_RE)].map((match) => match[1].trim()).filter(Boolean);
        if (blocks.length) return blocks.join('\n\n');
        return String(body || '').replace(/^\s*```[a-zA-Z]*\s*$/gm, '').trim();
    }

    function extractLiveUnits(text) {
        const source = String(text || '').replace(/\r\n/g, '\n');
        const headings = [...source.matchAll(LIVE_UNIT_HEADING_RE)];
        const units = [];
        // 末尾那个标题的正文多半还没写完，只取它前面已经收尾的单元
        for (let i = 0; i + 1 < headings.length; i += 1) {
            const heading = headings[i][0];
            const tag = heading.match(/P\s*\d{1,3}/);
            const code = tag ? tag[0].replace(/\s+/g, '').toUpperCase() : `P${String(i + 1).padStart(2, '0')}`;
            const rest = heading.slice(tag ? tag.index + tag[0].length : 0).trim().replace(/^[*#\s]+|[*#\s]+$/g, '');
            const tail = rest.split(/[｜|]/).map((part) => part.trim().replace(/^[*#\s]+|[*#\s]+$/g, '')).filter(Boolean);
            const body = source.slice(headings[i].index + heading.length, headings[i + 1].index).trim();
            units.push({
                code,
                duration: tail.length > 1 ? tail[0] : '',
                name: tail.length > 1 ? tail[1] : (tail[0] || ''),
                prompt: liveUnitPrompt(body),
                raw: body,
            });
        }
        return units;
    }

    // 大纲同理：条目序号和里面的 P 编号都要顺着上一段续排
    function mergeOutlines(parts) {
        let item = 0;
        return parts.map(({ outline, offset }) => String(outline || '')
            .replace(/^#\s*分段大纲\s*$/gm, '')
            .replace(/(\d+)\s*\.\s*P\s*(\d{1,3})/g, (all, num, code) => {
                item += 1;
                return `${item}. P${String(offset + Number(code)).padStart(2, '0')}`;
            })
            .trim()).filter(Boolean).join('\n\n');
    }

    // 单段跑一次；截断/失败都从这里带出去，由调用方决定要不要再切
    async function runSegment(segment) {
        const response = await fetch('/api/script/generate', {
            method: 'POST',
            headers: jsonHeaders,
            signal: state.controller.signal,
            body: JSON.stringify({ ...buildRequestBody(), script: segment }),
        });
        if (!response.ok) {
            const detail = await response.json().catch(() => ({}));
            throw new Error(detail.detail || `HTTP ${response.status}`);
        }
        const outcome = { units: [], outline: '', raw: '', truncated: false, error: '' };
        let live = '';
        await consumeStream(response, (event) => {
            if (event.type === 'meta') {
                if (event.model) state.model = event.model;
            } else if (event.type === 'delta') {
                // 上游逐 token 下发：攒起来实时渲染，写完的单元先以卡片形式显示
                live += event.text || '';
                state.live = live;
                state.liveUnits = extractLiveUnits(live);
                paintLiveProgress();
            } else if (event.type === 'episode_done') {
                outcome.units = event.units || [];
                outcome.outline = event.outline || '';
                outcome.raw = event.raw || '';
                outcome.truncated = event.truncated === true;
            } else if (event.type === 'episode_error') {
                outcome.error = event.detail || '';
            }
        });
        if (outcome.error) throw new Error(outcome.error);
        // 上游偶尔会悄悄把流掐掉：既不报错、也不发 episode_done，read() 直接结束。
        // 这种时候用流里已经写完的单元兜底，并当作被截断（交给上层对半重跑），
        // 否则这一段会被当成跑完，已经显示出来的分镜反而被丢掉。
        if (!outcome.units.length && state.liveUnits.length) {
            outcome.units = state.liveUnits.slice();
            outcome.raw = state.live || '';
            outcome.truncated = true;
        }
        return outcome;
    }

    // 生成失败自动重试：上游偶发抽风（断流、超时、限流）不该让用户盯着屏幕手动点「继续生成」。
    // 用户主动停止（AbortError）不重试，立刻退出；重试期间一直等，点击停止也会在下一跳生效。
    const SEGMENT_RETRY_TIMES = 3;
    const SEGMENT_RETRY_DELAY = 2000;

    async function runSegmentWithRetry(segment) {
        for (let attempt = 1; ; attempt += 1) {
            try {
                return await runSegment(segment);
            } catch (error) {
                if (error.name === 'AbortError' || attempt >= SEGMENT_RETRY_TIMES) throw error;
                setStatus(withRefreshWarn(tf('script.retrying', { n: attempt, total: SEGMENT_RETRY_TIMES - 1 })));
                await new Promise((resolve) => setTimeout(resolve, SEGMENT_RETRY_DELAY));
            }
        }
    }

    // 断点还在（队列没跑完）就算还有得跑，这是「继续生成后面分镜」的依据
    function pendingSession() {
        const session = state.session;
        if (!session || session.done || !(session.queue || []).length) return null;
        return state.results[0] ? session : null;
    }

    // 断点只认剧本和人物设定：队列里装的是按剧本切出来的分段，这两样换了就不能直接接，
    // 否则会把上一份剧本剩下的分段接到新设定后面（这种情况走卡片上的「继续生成后面分镜」）。
    // 模板 / 备注 / 允许改写 / 模型这些不拦：它们刷新页面后会回到默认值（模板由默认模板重置、
    // 备注和勾选本来就不落盘），按全量签名比对会导致刷新一次就再也点不到「继续生成」。
    function resumableSession() {
        const session = pendingSession();
        if (!session) return null;
        // 早期数据只存了签名、没有剧本快照，这种断点不再一刀切拦下，队列还在就允许接着跑
        if (typeof session.script === 'string') {
            if (session.script !== scriptContent()) return null;
            if ((session.characters || '') !== castAllText()) return null;
        }
        // 失败也允许接着跑：断流那一段已经放回队列，重试不用把前面几十段再生成一遍
        return session;
    }

    // 点「生成」前先把手里这份分镜留个底：新一轮会立刻把界面清空重来，
    // 万一第一个分段就断线失败、一条都没产出，用它可以原样还回去。
    function snapshotResults() {
        const first = state.results[0];
        if (!first || !(first.units || []).length) return null;
        return {
            title: first.title,
            outline: first.outline || '',
            raw: first.raw || '',
            units: first.units.map((unit) => ({ ...unit })),
        };
    }

    // 结果卡片上的「清除所有分镜提示词」：把这一份分镜的提示词整批清空（不可恢复，动手前确认一次）。
    // 只清提示词，不动人物/场景/道具，也不动 PenShot 与技能提取那两张卡片的结果。
    function clearUnitsOfEpisode(result) {
        if (!result) return;
        if (state.running || state.castRunning || state.bridgeRunning || state.shotSkillRunning) {
            toast(tr('script.clearUnitsBusy'));
            return;
        }
        const count = (result.units || []).length;
        if (!count) {
            toast(tr('script.clearUnitsEmpty'));
            return;
        }
        if (!window.confirm(tf('script.clearUnitsConfirm', { n: count }))) return;
        result.units = [];
        result.raw = '';
        result.status = 'done';
        state.unitsPage = {};
        // 用户明确要清空：允许这一次保存把已存的分镜整份清掉（保存后会复位）
        allowClearOnce = true;
        renderResults();
        toast(tf('script.clearUnitsDone', { n: count }));
    }

    // 结果卡片上的「重新生成全部分镜提示词」：无视断点，按现在的剧本 / 人物设定 / 画风
    // 把整批提示词重写一遍。动手前确认一次——已经出片的分镜会按编号保留，提示词会全换。
    function regenerateAllUnits(result) {
        if (state.running) return;
        const count = ((result && result.units) || []).length;
        if (!window.confirm(tf('script.regenEpisodeConfirm', { n: count }))) return;
        generate(false, true);
    }

    // forceTail：结果卡片上的「继续生成后面分镜」。剧本/人物设定跟断点对不上时也照样接着跑，
    // 用的是断点里还剩下的分段（属于改动前那份剧本），只是用当前的模板/设定继续写。
    // restart=true：无视断点，按现在的剧本 / 人物设定 / 画风把全部提示词从头重写一遍
    async function generate(forceTail, restart) {
        if (state.running) return;
        if (!scriptContent()) {
            toast(tr('script.needText'));
            return;
        }
        if (!$('templateText').value.trim()) {
            toast(tr('script.needTemplate'));
            return;
        }

        const resuming = restart ? false
            : (forceTail ? Boolean(pendingSession()) : Boolean(resumableSession()));
        // 重新生成提示词：先把已经出片的分镜按编号留一份，新分镜一出来就贴回自己的槽位
        const keptRuns = resuming ? null : collectUnitRuns();
        // 这一轮会先把界面清空重来；万一半路断线、一个字都没产出，用这份把旧的分镜还回去，
        // 否则点一次「生成」失败，手里那份已经写好的提示词就整片没了
        const restoreOnFail = resuming ? null : snapshotResults();
        if (!resuming) {
            state.results = [{
                index: 0,
                title: tr('script.result'),
                status: 'pending',
                outline: '',
                units: [],
                raw: '',
                error: '',
            }];
            state.session = {
                // 记下这份队列是按哪份剧本、哪份人物设定切出来的，换过就不能接着跑
                script: scriptContent(),
                characters: castAllText(),
                queue: splitScript(scriptContent()),
                // 大纲与原始输出按段累计，续跑时要沿用，否则大纲会从第一段重来
                outlineParts: [],
                rawParts: [],
                finished: 0,
                total: 0,
                done: false,
            };
            state.session.total = state.session.queue.length;
            // 新一轮从第一页看起，别沿用上一轮翻到的页
            state.unitsPage = {};
        }
        const session = state.session;
        state.live = '';
        state.liveUnits = [];
        state.running = true;
        state.controller = new AbortController();
        setRunningUI(true);

        const result = state.results[0];
        result.status = 'running';
        result.error = '';
        renderResults();

        try {
            while (session.queue.length) {
                // 先不出队：中途刷新或关掉页面时，这一段还在断点队列里，下次「继续生成」会补跑；
                // 老写法是先 shift 再请求，页面一刷新那段已经出队又没跑完，这一段的提示词就整段丢了
                const segment = session.queue[0];
                state.live = '';
                state.liveUnits = [];
                state.liveOffset = result.units.length;
                setStatus(withRefreshWarn(session.total > 1
                    ? tf('script.segmentProgress', { done: session.finished + 1, total: session.total })
                    : tr('script.generating')));
                renderResults();
                let outcome;
                try {
                    outcome = await runSegmentWithRetry(segment);
                } catch (error) {
                    // 队首还是这一段，不用放回；中断前已经流出来的那部分留在卡片里，别因为重跑就把这段文字也吞了
                    result.partialRaw = state.live || '';
                    throw error;
                }
                if (outcome.truncated && segment.length > SEGMENT_MIN_CHARS) {
                    // 这段还是被截断，对半切开重跑；替换掉队首那一段，合并顺序才不会乱
                    const halves = splitScript(segment, Math.ceil(segment.length / 2));
                    if (halves.length > 1) {
                        session.queue.splice(0, 1, ...halves);
                        session.total += halves.length - 1;
                        continue;
                    }
                }
                // 跑完了才出队
                session.queue.shift();
                const offset = result.units.length;
                result.units.push(...renumberUnits(outcome.units, offset));
                // 新分镜里还没成片的槽位，接上重写提示词之前跑好的成片
                attachUnitRuns(result.units, keptRuns);
                session.outlineParts.push({ outline: outcome.outline, offset });
                if (outcome.raw) session.rawParts.push(outcome.raw);
                result.outline = mergeOutlines(session.outlineParts);
                result.raw = session.rawParts.join('\n\n');
                result.truncated = result.truncated || outcome.truncated;
                result.error = '';
                result.partialRaw = '';
                result.status = 'running';
                session.finished += 1;
                state.live = '';
                state.liveUnits = [];
                renderResults();
            }
            session.done = true;
            state.session = null;
            result.status = 'done';
        } catch (error) {
            const aborted = error.name === 'AbortError';
            const message = aborted ? '' : String(error.message || error);
            if (!aborted) toast(message);
            // 这一轮一条分镜都还没产出就断了（或者刚点下「生成」就停了）：把点「生成」之前那份
            // 完整的还回去，否则界面只剩空的，手里那份已经写好的提示词就整片没了。
            if (restoreOnFail && !(result.units || []).length) {
                state.results = [{
                    index: 0,
                    title: restoreOnFail.title,
                    status: aborted ? 'paused' : 'error',
                    outline: restoreOnFail.outline,
                    units: restoreOnFail.units,
                    raw: restoreOnFail.raw,
                    error: message,
                    restored: true,
                }];
                // 断点跟还回去的这份对不上，一起丢掉：留着「继续生成」会把两批分镜拼在一起
                state.session = null;
            } else if (aborted) {
                if (session.queue.length) {
                    // 用户主动停止：已完成的分段留着，剩下的等「继续生成」
                    result.status = 'paused';
                } else {
                    session.done = true;
                    state.session = null;
                    result.status = 'done';
                }
            } else {
                state.results.forEach((item) => {
                    if (item.status === 'pending' || item.status === 'running') {
                        item.status = 'error';
                        item.error = message;
                    }
                });
            }
        } finally {
            state.running = false;
            state.controller = null;
            state.live = '';
            state.liveUnits = [];
            setRunningUI(false);
            setStatus(summaryText());
            renderResults();
        }
    }

    async function consumeStream(response, handler) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const pending = [];
        let buffer = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split('\n\n');
            buffer = chunks.pop() || '';
            for (const chunk of chunks) {
                const line = chunk.split('\n').find((item) => item.startsWith('data:'));
                if (!line) continue;
                try {
                    pending.push(JSON.parse(line.slice(5).trim()));
                } catch (e) { /* 忽略不完整事件 */ }
            }
            pending.splice(0).forEach(handler);
        }
        pending.splice(0).forEach(handler);
    }

    // 正在生成的状态行后面都挂上这句：刷新/关掉页面会把这一轮打断，状态会被改掉。
    // 浏览器原生的离开确认框文案不能自定义，所以提示得在页面上先给到。
    function withRefreshWarn(text) {
        return `${text} · ${tr('script.refreshWarn')}`;
    }

    function summaryText() {
        const result = state.results[0];
        if (!result) return '';
        if (result.status === 'error') return `${tr('script.failed')}：${result.error || ''}`;
        if (result.status === 'done' || result.status === 'paused') {
            const text = tf('script.unitCount', { n: (result.units || []).length });
            if (result.status === 'paused') return `${text} · ${tr('script.pausedHint')}`;
            return result.truncated ? `${text} · ${tr('script.truncated')}` : text;
        }
        return withRefreshWarn(tr('script.generating'));
    }

    function setStatus(text) {
        $('resultStatus').textContent = text || '';
    }

    // ---------- 结果渲染 ----------
    function unitSubtitle(unit) {
        return [unit.duration, unit.name].filter(Boolean).join(' · ');
    }

    function unitText(unit) {
        return unit.prompt || unit.raw || '';
    }

    // 3D 漫剧那类模板会在标题下方单独写一行「- 旁白（后期配音，不进提示词）：…」，
    // 它不进代码块（避免模型让角色念旁白），但配套的后期配音要用，所以从 raw 里取出来单独显示。
    const UNIT_NARRATION_RE = /^[ \t]*[-*]?[ \t]*旁白[（(][^）)]*[）)][ \t]*[：:][ \t]*(.+)$/m;
    // 没有旁白的单元模型也会照格式写一行「旁白：无」，这种占位别当成旁白摆在卡片上
    const UNIT_NARRATION_EMPTY_RE = /^[（(【\[]?\s*(无|暂无|空|none|n\/?a|—|-|–)?\s*[）)】\]]?[。.．]?$/i;

    function unitNarration(unit) {
        const raw = String((unit && unit.raw) || '');
        if (!raw) return '';
        const matched = raw.match(UNIT_NARRATION_RE);
        const text = matched ? matched[1].trim() : '';
        return UNIT_NARRATION_EMPTY_RE.test(text) ? '' : text;
    }

    // 分镜提示词可以直接在结果卡片上改。敲字时先把内容同步进内存（免得中途一次整卡重绘
    // 把刚写的字吞掉），点到别处（失焦）才真正落盘——本地缓存和剧本文件都是这一步写。
    function editedUnitOf(target) {
        const result = state.results[Number(target.dataset.episode)];
        return result && (result.units || [])[Number(target.dataset.unit)];
    }

    // 分镜卡片上的关联素材：把它提到的人物 / 场景，和上面画廊里已经生成好的本地图片连起来。
    // 有图就点开那张图（同一份素材），还没生成就给个空位提示，不再另存一份。
    function unitRefsInnerHtml(unit) {
        return castRefsOfUnit(unit).map(({ item, index }) => {
            const shot = castShotOf(item, index);
            const url = shot && shot.status === 'done' ? shot.url : '';
            const kindLabel = tr({
                scene: 'script.castScenes',
                prop: 'script.castProps',
            }[item.kind] || 'script.castCharacters');
            const title = `${kindLabel}｜${item.title}｜${item.prompt}`;
            const inner = `<span class="ref-thumb">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : ''}</span>
                <span class="ref-name">${esc(item.title)}</span>`;
            return url
                ? `<a class="unit-ref" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(title)}">${inner}</a>`
                : `<span class="unit-ref ref-idle" title="${esc(title)}">${inner}<span class="ref-tag">${esc(tr('script.refNoImage'))}</span></span>`;
        }).join('');
    }

    function unitRefsHtml(unit) {
        if (!castRefsOfUnit(unit).length) return '';
        return `<div class="unit-refs">
            <span class="ref-label">${esc(tr('script.unitRefs'))}</span>${unitRefsInnerHtml(unit)}
        </div>`;
    }

    function unitNarrationHtml(unit) {
        const narration = unitNarration(unit);
        if (!narration) return '';
        return `<div class="unit-narration" title="${esc(tr('script.unitNarrationHint'))}">
            <span class="ref-label">${esc(tr('script.unitNarration'))}</span><span class="narration-text">${esc(narration)}</span>
        </div>`;
    }

    // 关联素材的缩略图会随人物 / 场景的图生成而出现，只重刷这一块，不整卡重绘。
    // 命中的条目也可能增减（改了设定、补了人物），没有就补上、不该有就去掉。
    function refreshUnitRefs() {
        const result = state.results[0];
        if (!result) return;
        document.querySelectorAll('#results .unit[data-unit-card]').forEach((card) => {
            const unitIndex = Number(card.dataset.unitCard);
            const unit = (result.units || [])[unitIndex];
            if (!unit) return;
            const current = card.querySelector('.unit-refs');
            const html = unitRefsHtml(unit);
            if (!html) { if (current) current.remove(); return; }
            const holder = document.createElement('div');
            holder.innerHTML = html;
            const next = holder.firstElementChild;
            if (current) current.replaceWith(next);
            else card.querySelector('.unit-text').insertAdjacentElement('beforebegin', next);
        });
    }

    function episodeMarkdown(result) {
        const lines = [];
        (result.units || []).forEach((unit) => {
            const subtitle = [unit.duration, unit.name].filter(Boolean).join('｜');
            lines.push(`### ${unit.code}${subtitle ? '｜' + subtitle : ''}`, '', unitText(unit), '');
        });
        if (!result.units.length && result.raw) lines.push(result.raw, '');
        return lines.join('\n').trim();
    }

    // 分镜多了以后一屏摆不下（一百多个单元会拖成一条长龙），列表按页切，
    // 一页 20 个；复制 / 选中的单元仍然按整份算，翻页只影响显示。
    const UNITS_PER_PAGE = 20;

    function unitsPageCount(total) {
        return Math.max(1, Math.ceil(total / UNITS_PER_PAGE));
    }

    // 页码存在 state.unitsPage 里，加了新单元后按当前总数夹紧，避免停在空白页
    function unitsPageOf(result) {
        const total = (result.units || []).length;
        const page = Math.max(0, Math.min(Number(state.unitsPage[result.index]) || 0, unitsPageCount(total) - 1));
        state.unitsPage[result.index] = page;
        return page;
    }

    function goUnitsPage(result, action) {
        const last = unitsPageCount((result.units || []).length) - 1;
        const current = unitsPageOf(result);
        const targets = { first: 0, prev: current - 1, next: current + 1, last };
        const page = targets[action] === undefined ? current : targets[action];
        state.unitsPage[result.index] = Math.max(0, Math.min(page, last));
    }

    function unitsPagerHtml(result) {
        const total = (result.units || []).length;
        const pages = unitsPageCount(total);
        if (pages <= 1) return '';
        const page = unitsPageOf(result);
        const from = page * UNITS_PER_PAGE + 1;
        const to = Math.min(total, from + UNITS_PER_PAGE - 1);
        const jump = (action, label, disabled) => `<button class="btn btn-mini" data-action="unit-page" data-episode="${result.index}" data-page="${action}"${disabled ? ' disabled' : ''}>${esc(label)}</button>`;
        return `<div class="unit-pager">
            ${jump('first', tr('script.pageFirst'), page === 0)}
            ${jump('prev', tr('script.pagePrev'), page === 0)}
            <span class="muted">${esc(tf('script.pageInfo', { page: page + 1, pages, from, to, total }))}</span>
            ${jump('next', tr('script.pageNext'), page === pages - 1)}
            ${jump('last', tr('script.pageLast'), page === pages - 1)}
        </div>`;
    }

    // 已经写好的分镜排成网格：一页最多 UNITS_PER_PAGE 个，data-unit 用整份里的全局序号，
    // 勾选和单跑都不受影响。生成中也要用它——否则一轮几百段只看得到当前这一段，
    // 中途一断整片就是空白，像是提示词全丢了。
    function unitsGridHtml(result) {
        const page = unitsPageOf(result);
        const start = page * UNITS_PER_PAGE;
        const html = result.units.slice(start, start + UNITS_PER_PAGE).map((unit, offset) => {
            const unitIndex = start + offset;
            // 已经出过片的，按钮就是「重新生成」：新版留着旧版，跑完自己挑
            const rerunnable = unit.run && unit.run.status === 'succeeded';
            return `
                        <div class="unit" data-unit-card="${unitIndex}">
                            <div class="unit-head">
                                <div>
                                    <span class="title">${esc(unit.code || '')}</span>
                                    <span class="sub">${esc(unitSubtitle(unit))}</span>
                                </div>
                                <div class="row">
                                    <button class="btn" data-action="run-unit" data-episode="${result.index}" data-unit="${unitIndex}" title="${esc(tr(rerunnable ? 'script.comfyRerunHint' : 'script.comfyRunOneHint'))}"${unit.run && unit.run.status === 'running' ? ' disabled' : ''}>${esc(tr(rerunnable ? 'script.comfyRerun' : 'script.comfyRunOne'))}</button>
                                    <button class="btn" data-action="copy-unit" data-episode="${result.index}" data-unit="${unitIndex}">${esc(tr('script.copy'))}</button>
                                    ${chatDraftCount() ? `<button class="btn" data-action="insert-chat" data-episode="${result.index}" data-unit="${unitIndex}" title="${esc(tr('script.chatInsertHint'))}">${esc(tf('script.chatInsert', { n: chatDraftCount() }))}</button>` : ''}
                                </div>
                            </div>
                            ${unitNarrationHtml(unit)}
                            ${unitRefsHtml(unit)}
                            <textarea class="unit-text" data-unit-text data-episode="${result.index}" data-unit="${unitIndex}"
                                spellcheck="false" aria-label="${esc(tf('script.unitEditAria', { code: unit.code || '' }))}"
                                title="${esc(tr('script.unitEditHint'))}">${esc(unitText(unit))}</textarea>
                            <div class="unit-run-slot" data-unit-run="${unitIndex}">${unitRunHtml(unit, unitIndex, result.index)}</div>
                        </div>
                    `;
        }).join('');
        return `<div class="unit-grid">${html}</div>${unitsPagerHtml(result)}`;
    }

    function renderResults() {
        const box = $('results');
        const scrollY = window.scrollY;
        saveStoryboardState();
        syncUnitRunButtons();
        updateUnitRunStatus();
        if (!state.results.length) {
            box.innerHTML = `<div class="empty-hint">${esc(tr('script.empty'))}</div>`;
            setStatus('');
            return;
        }
        box.innerHTML = state.results.map((result) => {
            const badge = `<span class="badge ${result.status}">${esc(tr('script.' + result.status))}</span>`;
            const meta = (result.status === 'done' || result.status === 'paused' || result.status === 'error')
                ? esc(tf('script.unitCount', { n: (result.units || []).length }))
                : '';
            const streaming = result.status === 'running' || result.status === 'pending';
            let body = '';
            if (result.status === 'error') {
                body += `<div class="error-text">${esc(tr('script.failed'))}：${esc(result.error)}</div>`;
                // 失败/断流之前已经拿到的分镜照样摆出来，别让一次网络抖动把它们藏掉。
                // 提示按能找到什么来说：能直接接着跑、只能从卡片按钮续跑、还是断点根本没存下来。
                if ((result.units || []).length) {
                    const hint = result.restored ? 'script.errorRestored'
                        : (resumableSession() ? 'script.errorKept'
                        : (pendingSession() ? 'script.resumeUnavailable' : 'script.breakpointLost'));
                    body += `<div class="warn-text">${esc(tr(hint))}</div>`;
                }
            } else if (result.status === 'paused') {
                const hint = result.restored ? 'script.errorRestored'
                    : (resumableSession() ? 'script.pausedHint'
                    : (pendingSession() ? 'script.resumeUnavailable' : 'script.breakpointLost'));
                body += `<div class="warn-text">${esc(tr(hint))}</div>`;
            }
            if (streaming) {
                // 生成中：先摆已经写完的分段，再把当前分段的流式输出接在下面；
                // 增量刷新只改实时那块 DOM，不走整卡重绘（否则每个 token 都会连累一次 localStorage 写入）。
                if (result.units.length) body += unitsGridHtml(result);
                body += `<div class="raw-block live-block">
                    <div class="muted">${esc(tr('script.liveOutput'))}</div>
                    <div class="unit-grid live-units"></div>
                    <pre class="live-text"></pre>
                </div>`;
            } else {
                if (result.truncated) {
                    body += `<div class="warn-text">${esc(tr('script.truncated'))}</div>`;
                }
                if (result.outline) {
                    // 大纲动辄上百行，默认收起；单元列表才是要常看的部分
                    body += `<details class="outline"><summary>${esc(tr('script.outline'))}</summary><div style="margin-top:8px">${esc(result.outline)}</div></details>`;
                }
                if (result.units.length) {
                    body += unitsGridHtml(result);
                } else if (result.raw) {
                    body += `<div class="raw-block">
                        <div class="muted">${esc(tr('script.rawFallback'))}</div>
                        <pre>${esc(result.raw)}</pre>
                    </div>`;
                }
                if (result.partialRaw) {
                    // 中断那一段没写完的原文，收起来留着备查；重跑成功后会自动清掉
                    body += `<details class="outline"><summary>${esc(tr('script.partialRaw'))}</summary><div class="raw-block" style="margin-top:8px"><pre>${esc(result.partialRaw)}</pre></div></details>`;
                }
            }
            return `
                <div class="episode-card state-${result.status}">
                    <div class="episode-card-head">
                        <div>
                            <h2>${esc(result.title)}</h2>
                            <div class="meta">${badge} ${meta}</div>
                        </div>
                        ${streaming ? '' : `<div class="row">
                            ${!resumableSession() && pendingSession() ? `<button class="btn btn-primary" data-action="resume-tail" data-episode="${result.index}" title="${esc(tr('script.resumeTailHint'))}">${esc(tr('script.resumeTail'))}</button>` : ''}
                            <button class="btn" data-action="regen-episode" data-episode="${result.index}" title="${esc(tf('script.regenEpisodeHint', { n: (result.units || []).length }))}">${esc(tr('script.regenEpisode'))}</button>
                            <button class="btn" data-action="bridge-episode" data-episode="${result.index}" title="${esc(tr(state.bridgeRunning ? 'script.bridgeStopHint' : 'script.bridgeHint'))}">${esc(state.bridgeRunning ? (state.bridgeNote || tr('script.bridgeRunning')) : tr('script.bridgeUnits'))}</button>
                            <button class="btn" data-action="copy-episode" data-episode="${result.index}">${esc(tr('script.copyEpisode'))}</button>
                            ${(result.units || []).length ? `<button class="btn" data-action="clear-episode" data-episode="${result.index}" title="${esc(tr('script.clearUnitsHint'))}">${esc(tr('script.clearUnits'))}</button>` : ''}
                        </div>`}
                    </div>
                    ${body}
                </div>
            `;
        }).join('');
        window.scrollTo(0, scrollY);
    }

    // 流式输出的高频刷新：只更新实时区块（已收完的单元卡片 + 正在涌出的原文），
    // 不整卡重绘，避免每个 token 都写一次 localStorage、也避免把滚动位置抖掉。
    function paintLiveProgress() {
        const grid = document.querySelector('#results .live-units');
        // 单元卡片只在「又写完一个单元」时才重建，逐 token 阶段光更新原文就够了
        if (grid && grid.dataset.count !== String(state.liveUnits.length)) {
            grid.dataset.count = String(state.liveUnits.length);
            const units = renumberUnits(state.liveUnits, state.liveOffset);
            grid.innerHTML = units.length ? units.map((unit) => `
                <div class="unit">
                    <div class="unit-head">
                        <div>
                            <span class="title">${esc(unit.code || '')}</span>
                            <span class="sub">${esc(unitSubtitle(unit))}</span>
                        </div>
                    </div>
                    <pre>${esc(unitText(unit))}</pre>
                </div>
            `).join('') : '';
        }
        const pre = document.querySelector('#results .live-text');
        if (!pre) return;
        // 一直停在底部跟着新内容走；用户自己往上翻了就别抢滚动条
        const following = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
        pre.textContent = state.live;
        if (following) pre.scrollTop = pre.scrollHeight;
    }

    function finishedResult() {
        const result = state.results[0];
        return result && result.status === 'done' && ((result.units || []).length || result.raw) ? result : null;
    }

    // 交给 ComfyUI 跑只看有没有分镜，不看整份分镜是不是跑完了：
    // 中途停下或失败的那批也得能单个补跑、整批重跑。
    function runnableResult() {
        const result = state.results[0];
        return result && (result.units || []).length ? result : null;
    }

    // ---------- 单个分镜调用 ComfyUI ----------
    // 分镜默认走这条：它按参考图出画面，能把人物 / 场景的样子带进分镜里。
    // 用户在右侧工具栏「工作流」下拉里改过就以改过的为准（只记用户真的选过的，见 COMFY_WORKFLOW_KEY）。
    const DEFAULT_COMFY_WORKFLOW = 'custom/MINIMAX-H3八月最强文戏-高配版.json';
    // 旧键会在首次进页面时把「列表第一条例」写成用户选择，新默认值就再也轮不上，换个新键重来
    const COMFY_WORKFLOW_KEY = 'studio_script_comfy_workflow_v2';
    // 人物 / 场景参考图默认走这条：QWEN-IMAGE2.1 的工作流专门出角色三视图和场景概念图。
    // 用户在「工作流」下拉里改过就以改过的为准（见 studio_script_cast_comfy_workflow）。
    const DEFAULT_CAST_COMFY_WORKFLOW = 'custom/QWEN-IMAGE2.1.json';

    function comfyFieldKind(field) {
        if (['image', 'video', 'audio'].includes(field.type)) return field.type;
        if (field.bind_prompt === true) return 'prompt';
        if (field.bind_prompt === false) return 'setting';
        const key = `${field.input || ''} ${field.name || ''}`.toLowerCase();
        if (field.type === 'textarea' || /prompt|text|提示词|正向|负向/.test(key)) return 'prompt';
        return 'setting';
    }

    function comfyMediaLimit(field, kind) {
        const explicit = Number(field.max_items);
        if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
        return kind === 'image' ? 9 : 3;
    }

    // 一个字段要写进哪些节点：默认是 field.node，声明了 field.nodes 就以它为准
    // （H3 高配版的参考图要同时喂给 LOW / HIGH 两段 conditioning）
    function comfyFieldTargets(field) {
        const list = Array.isArray(field.nodes) ? field.nodes : [];
        const targets = (list.length ? list : [field.node]).map((id) => String(id || '').trim()).filter(Boolean);
        return [...new Set(targets)];
    }

    // 承载单元提示词的字段：普通 prompt 字段 + 标记 builtin_prompt 的文本字段（如 H3 的「参考文字」）
    function comfyPromptFields() {
        return (state.comfyFields || []).filter((field) => (
            field.node && field.input && (comfyFieldKind(field) === 'prompt' || field.builtin_prompt === true)
        ));
    }

    // 单元自带的时长是「15秒」这种写法，取出里面的秒数
    function unitSeconds(unit) {
        const matched = String(unit.duration || '').match(/\d+(?:\.\d+)?/);
        if (!matched) return null;
        const seconds = Number(matched[0]);
        return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
    }

    // 工作流里管时长的字段（H3 的 node 163「秒」就是它）。按名字认：
    // 名字或输入名里带「秒 / 时长 / duration / seconds / length」的数字字段。
    function comfyDurationField() {
        return (state.comfyFields || []).find((field) => {
            if (!field.node || !field.input) return false;
            if (comfyFieldKind(field) !== 'setting') return false;
            if (!['number', 'slider'].includes(field.type)) return false;
            return /秒|时长|duration|seconds?|length/i.test(`${field.input || ''} ${field.name || ''}`);
        });
    }

    // 分镜自己的时长优先于工作流默认值：P01 写的是 15 秒，时长就设成 15；
    // 分镜没写时长、或工作流里没有这类字段，就照旧用工作流自己的默认值。
    // 这里只管工作流字段自己的上下限；远端卡的显存上限（24G 卡 10 秒 / 32G 卡 15 秒）
    // 要等后端挑定主机才知道，由后端在提交前夹，所以顺带把字段位置报过去。
    function applyUnitDuration(params, unit) {
        const field = comfyDurationField();
        if (!field) return null;
        const seconds = unitSeconds(unit);
        if (seconds === null) return null;
        const min = Number(field.min);
        const max = Number(field.max);
        const lower = Number.isFinite(min) ? min : seconds;
        const upper = Number.isFinite(max) ? max : seconds;
        const value = Math.min(upper, Math.max(lower, seconds));
        const nodes = comfyFieldTargets(field);
        nodes.forEach((node) => {
            params[node] = params[node] || {};
            params[node][field.input] = value;
        });
        return nodes.length ? { nodes, input: field.input, seconds: value } : null;
    }

    async function errorMessage(response) {
        try {
            const data = await response.json();
            if (data && data.detail) return String(data.detail);
        } catch (error) { /* 非 JSON 响应 */ }
        return `HTTP ${response.status}`;
    }

    async function loadComfyWorkflows() {
        const response = await fetch('/api/workflows');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        state.comfyWorkflows = data.workflows || [];
        const select = $('comfyWorkflowSelect');
        select.innerHTML = '';
        state.comfyWorkflows.forEach((item) => {
            const option = document.createElement('option');
            option.value = item.name;
            option.textContent = item.title || item.name;
            select.appendChild(option);
        });
        const remembered = localStorage.getItem(COMFY_WORKFLOW_KEY) || '';
        const names = state.comfyWorkflows.map((item) => item.name);
        const target = names.includes(remembered) ? remembered
            : (names.includes(DEFAULT_COMFY_WORKFLOW) ? DEFAULT_COMFY_WORKFLOW : names[0]);
        if (target) {
            select.value = target;
            await selectComfyWorkflow(target);
        }
    }

    async function selectComfyWorkflow(name) {
        state.comfyWorkflow = name || '';
        state.comfyFields = [];
        state.comfyParams = {};
        state.comfyWorkflowJson = {};
        if (!state.comfyWorkflow) return;
        const response = await fetch(`/api/workflows/${encodeURIComponent(state.comfyWorkflow)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        state.comfyWorkflowJson = data.workflow || {};
        state.comfyFields = (data.config && data.config.fields) || [];
        state.comfyFields.forEach((field) => {
            if (!field.node || !field.input) return;
            state.comfyParams[field.id] = field.default ?? (field.type === 'boolean' ? false : (field.type === 'number' || field.type === 'slider' ? 0 : ''));
        });
    }

    // 把所有单元共用的参数（标量字段）先拼好，每个单元只替换提示词字段
    function buildComfyBaseParams() {
        const params = {};
        const promptIds = new Set(comfyPromptFields().map((field) => field.id));
        for (const field of state.comfyFields || []) {
            const targets = comfyFieldTargets(field);
            if (!targets.length || !field.input || promptIds.has(field.id)) continue;
            if (['image', 'video', 'audio'].includes(comfyFieldKind(field))) continue;
            targets.forEach((node) => {
                params[node] = params[node] || {};
                params[node][field.input] = state.comfyParams[field.id];
            });
        }
        return params;
    }

    // 真正会接进工作流的参考图：条目得存在，且它的图已经出好了（castShotOf 还要求提示词没被改过）。
    // 提示词里的 <Picture N> 编号只能按这一份来排——没图的条目不能占用编号，
    // 否则工作流严格校验会报「<Picture N> is not connected；available picture count is K」把节点跑挂。
    function unitCastRefItems(unit) {
        return castRefsOfUnit(unit).filter(({ item, index }) => {
            const shot = castShotOf(item, index);
            return Boolean(shot && shot.status === 'done' && shot.url);
        });
    }

    // 分镜里关联到的角色 / 场景图，出图后就是现成的参考图：
    // 人物定造型、场景定环境，带进工作流里，生成出来的画面才和人物设定是一个样子。
    function unitCastRefUrls(unit) {
        return unitCastRefItems(unit).map(({ item, index }) => castShotOf(item, index).url);
    }

    // 同一张参考图可能给多个分镜用，上传一次就够
    const comfyRefUploads = new Map();

    async function uploadComfyRefUrl(url) {
        if (comfyRefUploads.has(url)) return comfyRefUploads.get(url);
        const job = (async () => {
            const response = await fetch(url);
            if (!response.ok) return '';
            const name = String(url).split('?')[0].split('/').pop() || 'reference.png';
            const form = new FormData();
            form.append('files', await response.blob(), name);
            const uploaded = await fetch('/api/upload', { method: 'POST', body: form });
            if (!uploaded.ok) return '';
            const data = await uploaded.json();
            return ((data.files || [])[0] || {}).comfy_name || '';
        })().catch(() => '');
        comfyRefUploads.set(url, job);
        return job;
    }

    // 把本单元关联的人物 / 场景参考图接进工作流的「参考图片」
    // 工作流自带的节点长什么样：类型从工作流 JSON（或已经写好的参数）里认
    function comfyNodeClass(params, nodeId) {
        return workflowNodeClass(state.comfyWorkflowJson, params, nodeId);
    }

    async function attachUnitCastRefs(params, unit) {
        const urls = unitCastRefUrls(unit);
        if (!urls.length) return;
        const field = (state.comfyFields || []).find((item) => (
            comfyFieldKind(item) === 'image' && item.multi && comfyFieldTargets(item).length && item.input
        ));
        if (!field) return;
        const targets = comfyFieldTargets(field);
        const names = [];
        for (const url of urls.slice(0, comfyMediaLimit(field, 'image'))) {
            const name = await uploadComfyRefUrl(url);
            if (name) names.push(name);
        }
        if (!names.length) return;
        const usedIds = new Set([...Object.keys(params), ...Object.keys(state.comfyWorkflowJson || {})]);
        let seq = 950000;
        const allocate = () => {
            while (usedIds.has(String(seq))) seq += 1;
            usedIds.add(String(seq));
            return String(seq);
        };
        // 这份工作流用固定的 LoadImage 节点接参考图（数量视本次用到的素材而定）：
        // 前 N 个槽位换成这次的图，剩下没用到的槽位连到哪就把哪条线掐掉，
        // 否则工作流自带的占位参考图会跟着混进这一条视频里。
        const slotNodes = targets.filter((node) => comfyNodeClass(params, node) === 'LoadImage');
        if (slotNodes.length) {
            const spare = new Set(slotNodes.slice(names.length));
            if (spare.size) {
                Object.keys(state.comfyWorkflowJson || {}).forEach((id) => {
                    const inputs = ((state.comfyWorkflowJson || {})[id] || {}).inputs || {};
                    Object.keys(inputs).forEach((key) => {
                        const source = Array.isArray(inputs[key]) ? String(inputs[key][0]) : '';
                        if (!source || !spare.has(source)) return;
                        params[id] = params[id] || {};
                        params[id][key] = null;
                    });
                });
            }
            names.forEach((name, i) => {
                const node = slotNodes[i];
                if (!node) return;
                params[node] = { ...(params[node] || {}), inputs: { ...((params[node] || {}).inputs || {}), image: name } };
            });
            return;
        }
        const prefix = String(field.prefix || '').trim() || `${String(field.input).replace(/s$/i, '')}_`;
        targets.forEach((node) => {
            params[node] = params[node] || {};
            // 工作流自带的参考图槽位先清掉，免得和这次带进去的图叠在一起
            Object.keys(((state.comfyWorkflowJson || {})[node] || {}).inputs || {}).forEach((key) => {
                if (key.startsWith(`${field.input}.`)) params[node][key] = null;
            });
        });
        names.forEach((name, i) => {
            targets.forEach((node) => {
                const nodeId = allocate();
                params[nodeId] = { class_type: 'LoadImage', inputs: { image: name } };
                params[node][`${field.input}.${prefix}${i}`] = [nodeId, 0];
            });
        });
    }

    async function submitUnitToComfy(unit, baseParams, promptFields) {
        // 出片前先把 <Picture N> 对齐到实连的参考图数：工作流会严格校验两者，
        // 不齐就报「<Picture N> is not connected」让节点失败
        fixUnitPictureRefs(unit);
        const params = JSON.parse(JSON.stringify(baseParams));
        const text = unitText(unit);
        promptFields.forEach((field) => {
            comfyFieldTargets(field).forEach((node) => {
                if (!field.input) return;
                params[node] = params[node] || {};
                params[node][field.input] = text;
            });
        });
        await attachUnitCastRefs(params, unit);
        const durationParam = applyUnitDuration(params, unit);
        const response = await fetch('/api/canvas-comfy-tasks', {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify({
                prompt: text,
                workflow_json: state.comfyWorkflow,
                params,
                type: 'script-studio',
                client_id: '',
                comfy_free_memory: false,
                duration_param: durationParam || {},
            }),
        });
        if (!response.ok) throw new Error(await errorMessage(response));
        const created = await response.json();
        const taskId = created.task_id;
        if (!taskId) throw new Error(tr('script.failed'));
        // 沿用同一个 run 对象（版本 id 记在里面），只把它标成运行中重来一轮
        unit.run.status = 'running';
        unit.run.progress = '';
        unit.run.outputs = [];
        unit.run.error = '';
        refreshUnitRun(unit);
        for (;;) {
            await sleep(1600);
            const poll = await fetch(`/api/canvas-comfy-tasks/${encodeURIComponent(taskId)}`);
            if (!poll.ok) throw new Error(await errorMessage(poll));
            const data = await poll.json();
            if (data.status === 'succeeded') return data.result || {};
            if (data.status === 'failed') throw new Error(data.error || tr('script.failed'));
            // 落在哪台由后端定，回传的地址精简成短名记在版本上：卡片、「哪台在跑哪个
            // 分镜」那份清单都按短名认台，完整地址留在 backendUrl 里备用
            const backend = (data.progress && data.progress.backend) || data.backend || '';
            if (backend) {
                const short = backendShortName(backend);
                if (short !== unit.run.backend) {
                    unit.run.backend = short;
                    unit.run.backendUrl = backend;
                    // 落点定下来（或换了台）才重画那份按主机的清单，不必每次轮询都刷
                    updateUnitRunStatus();
                }
            }
            unit.run.progress = progressText(data.progress);
            refreshUnitRun(unit);
        }
    }

    // caa08ffce5f340a78de9b88c00f3ef11.region1.waas.aigate.cc → caa08ffc；
    // 自建直连的 117.50.44.37:8188 原样留着（本身就已经是短名）
    function backendShortName(address) {
        const host = String(address || '').replace(/^https?:\/\//i, '').split('/')[0];
        if (!host) return '';
        const label = host.split('.')[0];
        return /^[0-9a-f]{16,}$/i.test(label) ? label.slice(0, 8) : host;
    }

    function progressText(progress) {
        if (!progress) return '';
        const parts = [];
        if (progress.queue) parts.push(progress.queue);
        if (progress.value && progress.max) parts.push(`${progress.value}/${progress.max}`);
        if (progress.percent) parts.push(`${Math.round(Number(progress.percent))}%`);
        return parts.join(' · ');
    }

    function mediaFromResult(result) {
        const items = Array.isArray(result.items) ? result.items : [];
        if (items.length) return items;
        return (result.outputs || []).map((url) => ({ url, kind: comfyKindFromUrl(url) }));
    }

    function comfyKindFromUrl(url) {
        const clean = String(url || '').split('?')[0].toLowerCase();
        if (/\.(mp4|webm|mov|mkv)$/.test(clean)) return 'video';
        if (/\.(png|jpe?g|webp|gif|bmp)$/.test(clean)) return 'image';
        if (/\.(mp3|wav|flac|m4a|ogg)$/.test(clean)) return 'audio';
        return 'file';
    }

    // 分镜任务池：单个「运行」和「生成全部分镜」共用。这批能同时派几个分镜，看配了几台
    // ComfyUI 主机 —— 后端在每个任务提交前挑当前最空闲的那台（reserve_best_backend），
    // 所以有几台就同时派几条，正好一条一台。只配一台时还是一条一条来：同时提交
    // 只会在远端互相排队，进度也看不清。
    const unitRunPool = { queue: [], cursor: 0, active: 0, queued: new Set(), running: false, limit: 1, limitCheckedAt: 0, limitPending: false, hosts: [] };

    // 一批正跑着的时候，用户可能又去设置里加了一台主机。不能让这批一直卡在老并发数上，
    // 每隔一会儿问一次主机数，涨了就立刻补派（只是问一下本地接口，很便宜）。
    const UNIT_RUN_LIMIT_TTL = 15000;

    // 各台的连通性：绿点=连得上、红点=连不上（带原因）、灰点=还没测到。
    // 按配置里的原始地址存，和「哪台在跑哪个分镜」那份清单用同一份主机列表。
    let unitHostStatus = {};
    let unitHostTimer = null;
    // 定时探的间隔：够看出主机掉没掉线，又不至于一直去骚扰远端
    const UNIT_HOST_INTERVAL = 30000;
    // 连续探不通多久才出声提醒：一次抖动不喊，真掉线了才喊
    const HOST_DOWN_ALERT_MS = 5 * 60 * 1000;

    // 逐台探一次连通性和队列（后端并发探，几台一起测）。进页面、点「检测连接」、
    // 每 30 秒的定时检测都走这里。
    async function refreshUnitHosts(forceReloadList) {
        // 手动检测时顺带拉一次主机清单：刚在设置里加过主机，不刷新页面也能看到
        if (forceReloadList || !unitRunPool.hosts.length) await comfyInstanceCount();
        const addrs = unitRunPool.hosts.filter(Boolean);
        if (!addrs.length) {
            renderUnitRunHosts(runnableUnits());
            return;
        }
        // 只把状态改成「检测中」，掉线计时和「已经喊过没有」得留着：
        // 这两样是跨轮次累计的，一清就得重新数 5 分钟
        addrs.forEach((addr) => {
            unitHostStatus[addr] = { ...(unitHostStatus[addr] || {}), state: 'checking' };
        });
        renderUnitRunHosts(runnableUnits());
        let items = null;
        let failure = '';
        try {
            const response = await fetch('/api/comfyui/instances/status', {
                method: 'POST',
                headers: jsonHeaders,
                body: JSON.stringify({ instances: addrs }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            items = (((await response.json()) || {}).items) || [];
        } catch (error) {
            failure = String(error.message || error);
        }
        if (items) {
            items.forEach((row) => {
                const prev = unitHostStatus[row.backend] || {};
                if (row.ok) {
                    unitHostStatus[row.backend] = {
                        state: 'ok',
                        running: row.running || 0,
                        pending: row.pending || 0,
                    };
                    return;
                }
                unitHostStatus[row.backend] = {
                    state: 'fail',
                    error: row.error || '',
                    // 掉线从「第一次探不通」算起：中间只要探通一次，上面那条成功分支会
                    // 整个换掉这个对象、failSince 就没了，下次再掉线重新数 5 分钟。
                    // 注意别按 state 判断能不能留 —— 上面刚把状态改成「检测中」，留着才准
                    failSince: prev.failSince || Date.now(),
                    alerted: !!prev.alerted,
                };
            });
            alertDownHosts();
        } else {
            // 检测请求本身没发出去：这几台是「不知道」而不是「连不上」，别标红骗人。
            // 掉线计时照样留着：这一轮的检测接口抽风不该把已经数了几分钟的清零
            addrs.forEach((addr) => {
                const prev = unitHostStatus[addr] || {};
                unitHostStatus[addr] = {
                    state: 'unknown',
                    error: failure,
                    failSince: prev.failSince,
                    alerted: !!prev.alerted,
                };
            });
        }
        renderUnitRunHosts(runnableUnits());
        // 主机可用数变了（设置里加了台、或某台从掉线恢复）：立刻补派，别让主机闲着等下一轮
        syncUnitRunLimit();
    }

    // 连着 5 分钟探不通就出一次声。每台「每次掉线」只喊一次，恢复了再掉会重新喊。
    function alertDownHosts() {
        const down = unitRunPool.hosts.filter(Boolean).filter((addr) => {
            const st = unitHostStatus[addr] || {};
            return st.state === 'fail' && !st.alerted && Date.now() - (st.failSince || 0) >= HOST_DOWN_ALERT_MS;
        });
        if (!down.length) return;
        down.forEach((addr) => { unitHostStatus[addr].alerted = true; });
        const text = tf('script.hostDownVoice', {
            hosts: down.map((addr) => backendShortName(addr)).join('、'),
        });
        // 浏览器可能不给没交互过的页面出声，所以字也一起给一份，别白提醒
        toast(text);
        speakText(text);
    }

    function speakText(text) {
        try {
            if (!window.speechSynthesis || typeof SpeechSynthesisUtterance !== 'function') return;
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'zh-CN';
            window.speechSynthesis.speak(utterance);
        } catch (error) { /* 没语音能力就算了，上面那行字已经提示过 */ }
    }

    // 能派活的主机数：只有探到「连得上」的才占并发位，掉线的台不占（免得活压在死主机上）。
    // 一台都还没测出结果时按配置台数算，别把并发压到 0。
    function usableHostCount() {
        const hosts = unitRunPool.hosts.filter(Boolean);
        if (!hosts.length) return 1;
        const known = hosts.filter((addr) => ['ok', 'fail'].includes((unitHostStatus[addr] || {}).state));
        if (!known.length) return hosts.length;
        return Math.max(1, known.filter((addr) => unitHostStatus[addr].state === 'ok').length);
    }

    // 并发上限跟着「能用的主机数」走，变了就按新数字补派
    function syncUnitRunLimit() {
        const count = usableHostCount();
        unitRunPool.limitCheckedAt = Date.now();
        if (count === unitRunPool.limit) return;
        unitRunPool.limit = count;
        if (unitRunPool.running) pumpUnitRunPool();
        // 人物/场景的「全部生成」也按台数派活（castPoolLimit），台数变了同样要补位
        if (state.imageRunning) pumpCastPool();
    }

    function startUnitHostTimer() {
        stopUnitHostTimer();
        unitHostTimer = setInterval(() => {
            // 页面切走或被盖住时不探，省得白跑
            if (document.visibilityState === 'visible') refreshUnitHosts(false);
        }, UNIT_HOST_INTERVAL);
    }

    function stopUnitHostTimer() {
        if (unitHostTimer) clearInterval(unitHostTimer);
        unitHostTimer = null;
    }

    function runnableUnits() {
        const result = runnableResult();
        return (result && result.units) || [];
    }

    function refreshUnitRunLimit() {
        if (unitRunPool.limitPending) return;
        if (Date.now() - unitRunPool.limitCheckedAt < UNIT_RUN_LIMIT_TTL) return;
        unitRunPool.limitPending = true;
        comfyInstanceCount().then(() => {
            unitRunPool.limitPending = false;
            // 台数或「探得到的主机」变了就按新的来：多了立刻补派，少了不再往上压
            syncUnitRunLimit();
        });
    }

    async function comfyInstanceCount() {
        try {
            // no-store：刚在设置里加了主机，这里必须拿到最新的台数
            const response = await fetch('/api/comfyui/instances', { cache: 'no-store' });
            if (!response.ok) return 1;
            const data = await response.json();
            const list = (((data || {}).instances) || []).filter(Boolean);
            // 地址留一份，「哪台在跑哪个分镜」和主机连通性那两份清单都按它列
            if (list.length && list.join('|') !== unitRunPool.hosts.join('|')) {
                unitRunPool.hosts = list;
                // 主机列表变过（刚在设置里加了 / 删了），之前测的连通性不作数
                unitHostStatus = {};
            }
            return Math.max(1, list.length);
        } catch (error) {
            // 问不到主机数就当只有一台，退回串行
            return 1;
        }
    }

    function unitRunPoolHas(index) {
        return unitRunPool.queued.has(index);
    }

    // ---------- 分镜成片的版本 ----------
    // 重新生成不覆盖上一版：新版跑出来，旧版压进 runHistory，用户点版本号自己切、
    // 自己对比，挑中的那一版才算当前版。
    let runIdSeq = 0;

    function newRunId() {
        runIdSeq += 1;
        return `run-${Date.now().toString(36)}-${runIdSeq}`;
    }

    // 早先存下来的成片记录没有版本信息，进页面时补齐，之后才能按版本切换。
    // 还没跑过的分镜不碰，免得上百个单元白背一个空数组。
    function normalizeUnitRuns(unit) {
        if (!unit || typeof unit !== 'object' || !unit.run) return;
        if (!Array.isArray(unit.runHistory)) unit.runHistory = [];
        [unit.run].concat(unit.runHistory).forEach((run) => {
            if (!run) return;
            if (!run.id) run.id = newRunId();
            if (!run.createdAt) run.createdAt = Date.now();
        });
    }

    // 这个分镜跑过的所有版本，按跑出来的先后排
    function unitVersions(unit) {
        return [unit.run].concat(unit.runHistory || [])
            .filter(Boolean)
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    }

    // 「对比」是把每一版都摊开看的临时状态，不落盘，刷新页面就回到只显示当前版
    const unitCompareOpen = new Set();

    function toggleUnitCompare(unit) {
        if (unitCompareOpen.has(unit)) unitCompareOpen.delete(unit);
        else unitCompareOpen.add(unit);
        refreshUnitRun(unit);
    }

    // 切版本：选中的成为当前版，其余退回历史里
    function selectUnitVersion(unit, runId) {
        // 正在生成的那一版不给切，免得进度和错误提示跑到别的版本头上
        if (unit.run && unit.run.status === 'running') return;
        const all = [unit.run].concat(unit.runHistory || []).filter(Boolean);
        const target = all.find((run) => run.id === runId);
        if (!target || target === unit.run) return;
        unit.run = target;
        unit.runHistory = all.filter((run) => run !== target);
        refreshUnitRun(unit);
        updateUnitRunStatus();
    }

    // 还没成功跑出片、也不在池子里的分镜，才算「要补的」。
    // 补进新素材之后被打上 staleRefs 的那一版，也要挑回来重跑 ——
    // 它跑的时候清单里还没有这些参考图。
    function unitRunPending(unit, index) {
        if (unit.run && unit.run.staleRefs) return !unitRunPoolHas(index);
        return (!unit.run || unit.run.status !== 'succeeded') && !unitRunPoolHas(index);
    }

    // 分镜正文里 `<Picture N>` 的编号必须和「真正接进工作流的参考图」一一对上：
    // 工作流会严格校验提示词里引用的 <Picture N> 与实连图数，序号超出的直接报
    // "<Picture N> is not connected; available picture count is K"，节点就失败了。
    //   1) 按「一人一张」重排：两个角色挤进同一个槽位，模型分不清谁是谁；
    //   2) 引用了没有图的素材（或编号超出实连图数）的 <Picture N> 一律去掉标签 ——
    //      那张图根本没接进来，标签留着只会让工作流报错。
    // 头部那一排 <Subject…> 行是「这个镜头用到哪几张参考图」的声明。模型（技能提取）常把整张
    // 人物清单都写成头部，于是这个镜头根本没用到的角色也被写进提示词、参考图还会被接进工作流。
    // 关联素材里有谁，头部就只留谁；只对带 refNames 的单元做（老数据的头部是按镜头实际出场者
    // 生成的，别动）。返回是否改动过。
    function pruneUnitSubjectHeader(unit) {
        if (!unit || !(unit.refNames || []).filter((ref) => ref && ref.name).length) return false;
        const refs = castRefsOfUnit(unit);
        const want = { character: [], scene: [], prop: [] };
        const all = { character: [], scene: [], prop: [] };
        refs.forEach(({ item }) => want[item.kind].push(castNameKeys(item.title)));
        allCastEntries().forEach(({ item }) => all[item.kind].push(castNameKeys(item.title)));
        const keepLine = (kind, name) => {
            const keys = castNameKeys(name);
            if (want[kind].some((wanted) => keys.some((key) => wanted.includes(key)))) return true;
            // 名字对不上清单里任何条目（不是素材名，比如剧本里的普通地点）时原样留着 ——
            // 只有「清单里确实有这份素材、但本镜头没引用到」才删。
            return !all[kind].some((entry) => keys.some((key) => entry.includes(key)));
        };
        const text = String(unitText(unit) || '');
        const lines = text.split('\n').filter((line) => {
            const charLine = /^[ \t]*<\s*Subject\s*\d+\s*>\s*([^，,。\n]{1,40}?)\s*是\s*(?:<\s*Picture\s*\d+\s*>)?/.exec(line);
            if (charLine) return keepLine('character', charLine[1]);
            const sceneLine = /^[ \t]*<\s*Subject\s*\d+\s*>\s*是\s*([^，,。\n]{1,40}?)\s*场景\s*[。.]?\s*$/.exec(line);
            if (sceneLine) return keepLine('scene', sceneLine[1]);
            return true;
        });
        const next = lines.join('\n');
        if (next === text) return false;
        unit.prompt = next;
        if (String(unit.raw || '') === text) unit.raw = next;
        return true;
    }

    // 采用模型自己写的提示词时，把它自带的那一排 <Subject…> 头部整段丢掉，只留按本镜头
    // 实际引用重建的那一份（没有可写的头部时原文不动，免得把片段原有的参考声明也削掉）。
    function stripUnitSubjectHeader(text) {
        return String(text || '').split('\n').filter((line) => !/^\s*<\s*Subject/i.test(line)).join('\n').trim();
    }

    // 参考图是后来才出好的分镜：把「这一段用到哪几张参考图」的声明补进提示词头部。
    // 提取那一刻清单里还没出图的素材，当时进不了提示词（没图的 `<Picture N>` 只会让工作流报未连接）；
    // 出图之后要是不补，这几张参考图虽然接进了工作流，提示词里却一句都没提到它们。
    // 重建出来的声明块与提取时写的完全一致：只包含「已经有图」的素材，编号按接图顺序（人物在前）。
    // 声明块之外的内容一个字不动；没变化就返回 false（重复进页面、重复跑同步都是幂等的）。
    function ensureUnitSubjectHeader(unit) {
        if (!unit) return false;
        const refs = (unit.refNames || []).filter((ref) => ref && ref.name);
        if (!refs.length) return false;
        const header = penshotRefHeader(refs);
        if (!header) return false;
        const text = String(unitText(unit) || '');
        const body = text.split('\n').filter((line) => !/^\s*<\s*Subject/i.test(line)).join('\n').replace(/^\n+/, '');
        const next = header + body;
        if (next === text) return false;
        unit.prompt = next;
        if (String(unit.raw || '') === text) unit.raw = next;
        return true;
    }

    // 【参考图像锚定】里「图像N是…」的编号必须跟实际接进工作流的参考图一一对应：
    // 只留「这一段用到、并且已经出图」的素材那几条，编号按接图顺序（人物 → 场景 → 道具）重排；
    // 对不上的整条删掉。模型写错顺序或写进没用到的素材时，靠这一步纠正。
    const UNIT_IMAGE_ANCHOR_RE = /^[ \t]*图像\s*(\d+)\s*是\s*(.+)$/;

    function fixUnitImageAnchorLines(unit) {
        if (!unit || !(unit.refNames || []).filter((ref) => ref && ref.name).length) return false;
        const slots = unitCastRefItems(unit).map(({ item }, position) => ({
            keys: castNameKeys(item.title),
            number: position + 1,
        }));
        const text = String(unitText(unit) || '');
        if (!UNIT_IMAGE_ANCHOR_RE.test(text.split('\n')[0] || '') && !text.includes('【参考图像锚定】')) return false;
        let changed = false;
        const lines = [];
        text.split('\n').forEach((line) => {
            const matched = UNIT_IMAGE_ANCHOR_RE.exec(line);
            if (!matched) {
                lines.push(line);
                return;
            }
            const keys = castNameKeys(matched[2]);
            const slot = slots.find((entry) => entry.keys.some((key) => key.length >= 2 && line.includes(key))
                || keys.some((key) => key.length >= 2 && entry.keys.some((want) => want.length >= 2 && want.includes(key))));
            if (!slot) {
                changed = true;
                return;
            }
            const next = `图像${slot.number}是${matched[2]}`;
            if (next !== line) changed = true;
            lines.push(next);
        });
        if (!changed) return false;
        const next = lines.join('\n');
        unit.prompt = next;
        if (String(unit.raw || '') === text) unit.raw = next;
        return true;
    }

    function fixUnitPictureRefs(unit) {
        if (!unit) return false;
        const anchored = fixUnitImageAnchorLines(unit);
        const ensured = ensureUnitSubjectHeader(unit);
        const pruned = pruneUnitSubjectHeader(unit);
        const items = unitCastRefItems(unit);
        const chars = items.filter(({ item }) => item.kind === 'character');
        const slots = chars.map(({ item }, position) => ({ keys: castNameKeys(item.title), number: position + 1 }));
        const text = String(unitText(unit) || '');
        let next = text;
        if (slots.length >= 2) {
            next = next.replace(
                /(<Subject\s*\d+\s*>\s*)([^，,。\n]{1,40}?)(\s*是\s*<Picture\s+)(\d+)(\s*>)/g,
                (whole, head, name, mid, old, tail) => {
                    const nameKeys = castNameKeys(name);
                    const slot = slots.find((entry) => nameKeys.some((key) => entry.keys.includes(key)));
                    if (!slot || String(slot.number) === String(old)) return whole;
                    return `${head}${name}${mid}${slot.number}${tail}`;
                },
            );
        }
        const count = items.length;
        next = next.replace(/<Picture\s+(\d+)\s*>/g, (whole, num) => (Number(num) <= count ? whole : ''));
        if (next === text) return pruned || ensured || anchored;
        unit.prompt = next;
        if (String(unit.raw || '') === text) unit.raw = next;
        return true;
    }

    // 这些素材（人物 / 场景 / 道具条目）在分镜里被用到的单元，统一走一遍同步：
    //   1) 卡片上的「关联素材」靠 refreshUnitRefs 自动出现（syncCastGallery 里已经调过）；
    //   2) 正文里的 <Picture N> 按「一人一张」重排；
    //   3) 旧成片打上「素材已更新」标记，下次「全部生成」会把它们重跑，旧的那一版原样留在版本条里。
    function syncUnitsForRefItems(items) {
        const keys = new Set();
        (items || []).forEach((item) => {
            if (item) castNameKeys(item.title).forEach((key) => keys.add(key));
        });
        // 用 runnableResult 而不是 finishedResult：暂停 / 断流过的分镜一样摆着、一样要重跑，
        // 要求整份分镜 status 是 done 会把「中途停过」的剧本整个漏掉。
        const result = runnableResult();
        if (!keys.size || !result) return 0;
        const wanted = [...keys];
        let units = 0;
        (result.units || []).forEach((unit) => {
            const text = normalizeRefName([unitText(unit), unit.name, unit.raw].filter(Boolean).join(' '));
            // 除了「正文里提到这个名字」的单元，带引用的单元（技能提取 / PenShot 采用）只要引用了这份素材
            // 也算 —— 它的提示词可能一个字都没写这个素材，但它确实要用这份参考图。
            const byText = wanted.some((key) => text.includes(key));
            const byRefs = castRefsOfUnit(unit).some(({ item }) => castNameKeys(item.title).some((key) => keys.has(key)));
            if (!byText && !byRefs) return;
            units += 1;
            fixUnitPictureRefs(unit);
            if (unit.run) unit.run.staleRefs = true;
            refreshUnitRun(unit);
        });
        if (units) saveStoryboardState();
        return units;
    }

    // 刚补进清单的新条目（entries 是 {kind, index}）对应到分镜上
    function markUnitsForNewRefs(entries) {
        return syncUnitsForRefItems(
            (entries || []).map((entry) => (state.castItems[entry.kind] || [])[entry.index]),
        );
    }

    // 进页面时的回填，两件事一起做：
    //   1) 带引用（技能提取 / PenShot 采用）的单元：按当前出图情况把「这一段用到哪几张参考图」的声明补齐 ——
    //      提取时清单里还没出图的素材，就是靠这一步才进得了提示词；
    //   2) 已经出过片的单元：正文里的 <Picture N> 按「一人一张」重排，编号跟实连图对不上的一律去掉。
    // 老数据（没有引用）只在「已经有成片」时才动编号，别的照旧。改动过且已经有成片的，标记待重跑
    //（提示词变了，得用新的参考图重跑一遍）；没改动的重复进页面不会反复标记，是幂等的。
    function backfillUnitRefSync() {
        const result = runnableResult();
        if (!result) return 0;
        let changed = 0;
        (result.units || []).forEach((unit) => {
            const hasVideo = Boolean(unit.run && unitRunVideoUrl(unit.run));
            const isRefUnit = (unit.refNames || []).some((ref) => ref && ref.name);
            if (!hasVideo && !isRefUnit) return;
            if (!fixUnitPictureRefs(unit)) return;
            changed += 1;
            if (!hasVideo) return;
            unit.run.staleRefs = true;
            refreshUnitRun(unit);
        });
        if (changed) {
            saveStoryboardState();
            // 必须强制写盘：调用方（loadScriptProject 收尾）会在回填之后把「当前状态」记成指纹，
            // 防抖那次保存一比对就当「没变化」直接跳过，标记就只留在 localStorage、本机文件里没有。
            flushScriptProject({ force: true });
        }
        return changed;
    }

    // 给一组片段按 ref_map（frag_xxx → 场景 / 人物）把关联并集补上；已经有值的不动。
    function applyFragmentRefs(frags, raw) {
        let changed = false;
        (frags || []).forEach((frag) => {
            if (!frag || !(frag.source_fragments || []).length) return;
            if ((frag.characters || []).length || (frag.scenes || []).length) return;
            const chars = [];
            const scenes = [];
            frag.source_fragments.forEach((fid) => {
                const ref = raw[String(fid)] || {};
                (ref.characters || []).forEach((name) => { if (name && !chars.includes(name)) chars.push(name); });
                (ref.scenes || []).forEach((name) => { if (name && !scenes.includes(name)) scenes.push(name); });
            });
            if (chars.length || scenes.length) {
                frag.characters = chars;
                frag.scenes = scenes;
                changed = true;
            }
        });
        return changed;
    }

    // 旧存档的 PenShot 片段是本次功能上线前跑的，没带场景 / 人物标识（但阶段产物还在服务端）。
    // 进页面时按片段所属任务号拉一次关联回填，之后「采用 / 回填」就能正常绑定参考图，不用重跑管线。
    async function enrichPenshotFragmentRefs() {
        const saved = state.penshot;
        if (!saved || !scriptProjectId) return;
        const groups = [];
        if (Array.isArray(saved.fragments)) groups.push({ frags: saved.fragments, taskId: String(saved.taskId || '') });
        (saved.history || []).forEach((snap) => {
            if (snap && Array.isArray(snap.fragments)) {
                groups.push({ frags: snap.fragments, taskId: String(snap.taskId || saved.taskId || '') });
            }
        });
        const needs = (frags) => (frags || []).some((frag) => (
            frag && (frag.source_fragments || []).length && !(frag.characters || []).length && !(frag.scenes || []).length
        ));
        const pending = groups.filter((group) => group.taskId && needs(group.frags));
        if (!pending.length) return;
        const rawByTask = {};
        await Promise.all([...new Set(pending.map((group) => group.taskId))].map(async (taskId) => {
            try {
                const url = `/api/script/penshot/refs?script_id=${encodeURIComponent(scriptProjectId)}&task_id=${encodeURIComponent(taskId)}`;
                const response = await fetch(url);
                rawByTask[taskId] = response.ok ? (((await response.json()) || {}).fragments || {}) : {};
            } catch (error) {
                rawByTask[taskId] = {};
            }
        }));
        let changed = false;
        pending.forEach((group) => {
            if (applyFragmentRefs(group.frags, rawByTask[group.taskId] || {})) changed = true;
        });
        if (changed) flushPenshotPersist(true);
    }

    // PenShot「采用」过来的分镜：片段自带它对应的场景 / 人物，但采用那一刻清单里未必已经有这些素材，
    // 或者当时是旧版本（片段还没带 characters / scenes）。进页面时按 fragment_id 在当前快照里回查一次，
    // 把能绑上的参考图补上、并把 <Picture> / 场景引用写进提示词；对不上的原样不动，重复进页面也是幂等的。
    function backfillPenshotUnitRefs() {
        const result = runnableResult();
        const snapshot = currentPenshotSnapshot();
        if (!result || !snapshot) return 0;
        const byId = {};
        (snapshot.fragments || []).forEach((frag) => {
            if (frag && frag.fragment_id) byId[String(frag.fragment_id)] = frag;
        });
        let changed = 0;
        (result.units || []).forEach((unit) => {
            const ref = String(unit.penshotRef || '');
            if (!ref) return;
            const fragment = byId[ref];
            if (!fragment) return;
            const refNames = penshotFragmentRefNames(fragment);
            if (!refNames.length) return;
            if (JSON.stringify(refNames) === JSON.stringify(unit.refNames || [])) return;
            unit.refNames = refNames;
            const header = penshotRefHeader(refNames);
            const prompt = String(unit.prompt || '');
            // 只在正文还没写引用头时才补，避免重复插
            if (header && !prompt.startsWith('<Subject')) {
                unit.prompt = header + prompt;
                unit.raw = header + String(unit.raw || '');
            }
            if (unit.run) unit.run.staleRefs = true;
            refreshUnitRun(unit);
            changed += 1;
        });
        if (changed) {
            saveStoryboardState();
            flushScriptProject({ force: true });
        }
        return changed;
    }

    // 这一版跑出来的成片地址（只取视频）
    function unitRunVideoUrl(run) {
        const item = (((run || {}).outputs) || []).find((out) => out && out.kind === 'video' && out.url);
        return item ? String(item.url) : '';
    }

    // 哪些分镜是「状态是成功、成片却已经不在磁盘上了」。
    // 成片被手动移走或删掉之后，run.status 还是 succeeded，光看状态会一直跳过它们，
    // 于是这些分镜永远不出片。交给服务端逐个 stat 一遍，问出哪些地址已经失效。
    async function lostVideoIndexes(entries) {
        const targets = [];
        entries.forEach(({ unit, index }) => {
            const run = unit.run || {};
            if (run.status !== 'succeeded') return;
            targets.push({ index, url: unitRunVideoUrl(run) });
        });
        if (!targets.length) return new Set();
        // 压根没记下成片地址的，也算没片子
        const lost = new Set(targets.filter((item) => !item.url).map((item) => item.index));
        const urls = targets.filter((item) => item.url).map((item) => item.url);
        if (!urls.length) return lost;
        try {
            const response = await fetch('/api/script/check-media', {
                method: 'POST',
                headers: jsonHeaders,
                body: JSON.stringify({ urls }),
            });
            if (!response.ok) return lost;
            const data = await response.json().catch(() => ({}));
            const missing = new Set(data.missing || []);
            targets.forEach((item) => {
                if (item.url && missing.has(item.url)) lost.add(item.index);
            });
        } catch (error) {
            // 查不了就当都在，别因此把一整批已出片的分镜重跑一遍
            return lost;
        }
        return lost;
    }

    // 正在跑、或已经排进池子的，别再点一次；已经出过片的可以重新生成
    function unitRunBusy(unit, index) {
        return unitRunPoolHas(index) || Boolean(unit.run && unit.run.status === 'running');
    }

    // 提交前的统一检查：工作流选好没有、有没有能写入提示词的字段
    function unitRunReady() {
        if (!state.comfyWorkflow) {
            toast(tr('script.comfyNoWorkflow'));
            return false;
        }
        if (!comfyPromptFields().length) {
            toast(tr('script.comfyNoPromptField'));
            return false;
        }
        return true;
    }

    // 单独运行一个分镜：只把这个单元的提示词写进工作流并提交。
    // 已经出过片的再点就是「重新生成」，新版会作为新的一版存下来，旧版留着供对比。
    function runSingleUnit(unitIndex) {
        // 分镜还在写的时候先别提交，此刻的单元可能只有半截
        const result = state.controller ? null : runnableResult();
        const unit = result && (result.units || [])[unitIndex];
        if (!unit) {
            toast(tr(state.controller ? 'script.comfyBusy' : 'script.comfyNeedStoryboard'));
            return;
        }
        if (!unitRunReady()) return;
        if (unitRunBusy(unit, unitIndex)) {
            toast(tr('script.comfyBusy'));
            return;
        }
        enqueueUnitRuns([{ unit, index: unitIndex }]);
    }

    // 全部生成：按顺序补还没成功过的分镜，已经出片的不重跑
    async function runAllUnits() {
        const result = state.controller ? null : runnableResult();
        if (!result) {
            toast(tr(state.controller ? 'script.comfyBusy' : 'script.comfyNeedStoryboard'));
            return;
        }
        if (!unitRunReady()) return;
        // 素材库里已经躺着成片的先认回来，免得把出过片的分镜再跑一遍
        await matchLibraryVideos();
        const entries = (result.units || []).map((unit, index) => ({ unit, index }));
        // 状态是成功、成片文件却已经不在了的（被移走或删掉），也挑回来重跑，
        // 否则它们会被当成「已出片」永远跳过、一直不出片
        const lost = await lostVideoIndexes(entries);
        const pending = entries.filter(({ unit, index }) => unitRunPending(unit, index) || lost.has(index));
        if (!pending.length) {
            toast(tr(unitRunPool.running ? 'script.comfyAllBusy' : 'script.comfyAllDone'));
            return;
        }
        if (lost.size) toast(tf('script.comfyLostRetry', { n: lost.size }));
        enqueueUnitRuns(pending);
    }

    async function enqueueUnitRuns(entries) {
        // 已经在池里的条目不再重复入队，免得同一段提交两次
        entries.forEach(({ unit, index }) => {
            if (unitRunPoolHas(index)) return;
            unitRunPool.queued.add(index);
            unitRunPool.queue.push({ unit, index });
        });
        if (!unitRunPool.queue.length) return;
        if (!unitRunPool.running) {
            unitRunPool.running = true;
            // 开新一批时问一次主机数：在设置里改了几台，不用刷新页面也能生效。
            // 并发按「探得到的主机」定，掉线的那台不占位，活不往死主机上压
            await comfyInstanceCount();
            unitRunPool.limit = usableHostCount();
            unitRunPool.limitCheckedAt = Date.now();
            setUnitRunUI(true);
        } else {
            // 追加到正在跑的那一批。若此刻停在半路（点了「停止」但还有一条在跑），
            // 这次点击算改主意：撤销停止接着跑。
            state.comfyStop = false;
        }
        updateUnitRunStatus();
        pumpUnitRunPool();
    }

    // 按并发上限把队列里的分镜派出去；每跑完一条回来补位，直到池子空下来
    function pumpUnitRunPool() {
        while (!state.comfyStop
            && unitRunPool.active < unitRunPool.limit
            && unitRunPool.cursor < unitRunPool.queue.length) {
            const entry = unitRunPool.queue[unitRunPool.cursor];
            unitRunPool.cursor += 1;
            unitRunPool.active += 1;
            runUnitTask(entry.unit).finally(() => {
                unitRunPool.active -= 1;
                updateUnitRunStatus();
                pumpUnitRunPool();
            });
        }
        // 停的时候队列里往往还剩没派出去的，此时不能等 cursor 追上 queue.length，
        // 否则池子会永远停在「生成中」：停止按钮不隐藏、也再起不了新的一批。
        if (!unitRunPool.active && (state.comfyStop || unitRunPool.cursor >= unitRunPool.queue.length)) finishUnitRunPool();
        // 队列里还有人等着、并发却已经顶满：顺手看看主机是不是又加了，是就多派几条
        else if (unitRunPool.cursor < unitRunPool.queue.length && unitRunPool.active >= unitRunPool.limit) refreshUnitRunLimit();
    }

    function finishUnitRunPool() {
        if (!unitRunPool.running) return;
        const stopped = state.comfyStop;
        unitRunPool.running = false;
        unitRunPool.queue = [];
        unitRunPool.cursor = 0;
        unitRunPool.queued = new Set();
        state.comfyStop = false;
        setUnitRunUI(false);
        updateUnitRunStatus();
        if (stopped) toast(tr('script.comfyStopped'));
    }

    // 跑一个分镜：把它的提示词写进工作流、等结果、出片后顺手存进素材库
    async function runUnitTask(unit) {
        // 上一版先收进历史：新跑出来的是「多一版」，不是把原来那版顶掉
        normalizeUnitRuns(unit);
        if (unit.run) unit.runHistory = [unit.run].concat(unit.runHistory || []);
        const run = { id: newRunId(), createdAt: Date.now(), status: 'running', progress: '', outputs: [], error: '' };
        unit.run = run;
        refreshUnitRun(unit);
        try {
            const data = await submitUnitToComfy(unit, buildComfyBaseParams(), comfyPromptFields());
            const outputs = mediaFromResult(data);
            run.status = outputs.length ? 'succeeded' : 'failed';
            run.progress = '';
            run.outputs = outputs;
            run.error = outputs.length ? '' : tr('script.comfyNoOutput');
        } catch (error) {
            run.status = 'failed';
            run.progress = '';
            run.outputs = [];
            run.error = String(error.message || error);
        }
        refreshUnitRun(unit);
        saveUnitRunToLibrary(unit, run);
    }

    function setUnitRunUI(running) {
        // 「生成全部分镜」不跟着隐藏：跑着的时候点它，没跑过的分镜会追加进同一批。
        // 只有一个「停止」，点了随时收手（正在跑的那条会跑完）。
        $('stopAllUnitsBtn').hidden = !running;
        syncUnitRunButtons();
    }

    // 没有分镜时按钮点不动，免得点了只弹一句提示
    function syncUnitRunButtons() {
        const result = runnableResult();
        $('runAllUnitsBtn').disabled = !(result && (result.units || []).length);
    }

    // 这批分镜实际落在哪几台主机上（配了多台时，一眼看出有没有真的分散）
    function unitRunHosts(list) {
        const counts = new Map();
        list.forEach((unit) => {
            const host = unit.run && unit.run.backend;
            if (host) counts.set(host, (counts.get(host) || 0) + 1);
        });
        return Array.from(counts).map(([host, n]) => `${host}×${n}`).join(' · ');
    }

    // 主机清单：一台一行 —— 灯 + 主机名 + 这台正在跑本页的哪几个分镜 + 队列情况。
    // 配了但没派到活的主机也列出来，好和「没派到活」区分开。
    function unitRunHostRows(list) {
        const addresses = unitRunPool.hosts.filter(Boolean);
        if (!addresses.length) {
            // 主机清单还没拉到（比如本地接口没通），先按正在跑的分镜认几台出来，别空着
            list.forEach((unit) => {
                const run = unit.run;
                if (!run || !run.backend) return;
                const full = run.backendUrl || run.backend;
                if (!addresses.includes(full)) addresses.push(full);
            });
        }
        const rows = addresses.map((address) => ({
            address,
            host: backendShortName(address),
            codes: [],
        }));
        const byHost = new Map(rows.map((row) => [row.host, row]));
        list.forEach((unit, index) => {
            const run = unit.run;
            if (!run || run.status !== 'running' || !run.backend) return;
            const row = byHost.get(run.backend);
            if (row) row.codes.push(unit.code || `#${index + 1}`);
        });
        return rows;
    }

    function unitHostDotClass(state) {
        if (state === 'ok' || state === 'fail' || state === 'checking') return state;
        return '';
    }

    function unitHostTailText(st) {
        if (st.state === 'checking') return tr('script.hostChecking');
        if (st.state === 'ok') {
            return st.running || st.pending
                ? tf('script.hostTasks', { running: st.running, pending: st.pending })
                : tr('script.comfyHostIdle');
        }
        if (st.state === 'fail') return `${tr('script.hostOffline')} · ${st.error || ''}`;
        // 检测请求没发出去时这几台是「不知道」，不是「连不上」
        if (st.state === 'unknown') return tf('script.hostCheckFailed', { error: st.error || '' });
        return tr('script.hostNotChecked');
    }

    function renderUnitRunHosts(list) {
        const box = $('unitsRunHosts');
        if (!box) return;
        const rows = unitRunHostRows(list);
        const head = '<div class="run-hosts-head">'
            + `<span>${esc(tr('script.hostPanel'))}</span>`
            + `<button class="run-hosts-check" type="button" data-host-check>${esc(tr('script.hostCheck'))}</button>`
            + '</div>';
        if (!rows.length) {
            box.innerHTML = head
                + `<div class="run-host"><span class="run-host-units">${esc(tr('script.hostNoHost'))}</span></div>`;
            return;
        }
        box.innerHTML = head + rows.map((row) => {
            const st = unitHostStatus[row.address] || { state: '' };
            const dot = unitHostDotClass(st.state);
            const tail = st.state === 'ok' || st.state === 'fail' ? ` ${st.state}` : '';
            return `<div class="run-host" title="${esc(row.address)}">`
                + `<span class="host-dot${dot ? ' ' + dot : ''}"></span>`
                + `<span class="run-host-name">${esc(row.host)}</span>`
                + `<span class="run-host-units">${esc(row.codes.join(' · '))}</span>`
                + `<span class="host-tail${tail}">${esc(unitHostTailText(st))}</span>`
                + '</div>';
        }).join('');
    }

    function updateUnitRunStatus() {
        const list = runnableUnits();
        const status = $('unitsRunStatus');
        if (!status) return;
        renderUnitRunHosts(list);
        if (!list.length) {
            status.textContent = '';
            return;
        }
        const runs = list.map((unit) => unit.run).filter(Boolean);
        const done = runs.filter((run) => run.status === 'succeeded').length;
        const failed = runs.filter((run) => run.status === 'failed').length;
        const hosts = unitRunHosts(list);
        const hostText = hosts ? ` · ${tf('script.comfyHost', { host: hosts })}` : '';
        if (unitRunPool.running) {
            status.textContent = withRefreshWarn(tf('script.comfyProgress', { done: done + failed, total: list.length }) + hostText);
            return;
        }
        status.textContent = done || failed ? tf('script.comfySummary', { done, failed, total: list.length }) + hostText : '';
    }

    // 出片后自动把成片存进素材库：视频进「生成视频」分组、图片进「生成图片」分组。
    // 存没存过记在输出记录上（跟着分镜结果一起落盘），刷新页面不会重复入库；
    // inFlight 挡的是「还在存的时候又被触发一次」这种同一份存两遍。
    const unitLibraryInFlight = new Set();

    async function saveUnitRunToLibrary(unit, targetRun) {
        const run = targetRun || unit.run;
        if (!run || run.status !== 'succeeded') return;
        const name = [unit.code, unit.name].filter(Boolean).join(' ') || '分镜';
        for (const media of run.outputs || []) {
            const url = media.url || '';
            const kind = media.kind || comfyKindFromUrl(url);
            if (!url || media.inLibrary || unitLibraryInFlight.has(url)) continue;
            // 音频之类的没有对应分组，跳过
            if (kind !== 'video' && kind !== 'image') continue;
            unitLibraryInFlight.add(url);
            try {
                const response = await fetch('/api/script/save-media-to-library', {
                    method: 'POST',
                    headers: jsonHeaders,
                    body: JSON.stringify({ url, name, kind, library_id: scriptAssetLibraryId }),
                });
                if (!response.ok) throw new Error(await errorMessage(response));
                media.inLibrary = true;
                saveStoryboardState();
            } catch (error) {
                // 素材库没存上不该影响出片，提示一声就过去
                toast(tf('script.librarySaveFailed', { name, detail: String(error.message || error) }));
            } finally {
                unitLibraryInFlight.delete(url);
            }
        }
    }

    // 素材库里已有的成片，按名字认领回分镜上：条目名就是「P09 心口上的干饼」这种
    // 「编号 + 分镜名」，两者都对得上才认。只认编号是不行的 —— 不同剧本的分镜编号都
    // 从 P01 重新排，那会把别的戏的成片接到这一段上。认回来的跟正常跑出来的一样算
    // 「已出片」，所以「生成全部分镜」不会再跑它一遍；已经成功出过片的分镜不动。
    function libraryNameKey(text) {
        return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function unitLibraryMatched(unit, name) {
        const text = libraryNameKey(name);
        if (!text) return false;
        const code = libraryNameKey(unit.code);
        if (code && text === code) return true;
        const full = libraryNameKey([unit.code, unit.name].filter(Boolean).join(' '));
        return Boolean(full) && text === full;
    }

    async function matchLibraryVideos() {
        const result = state.controller ? null : runnableResult();
        const units = (result && result.units) || [];
        if (!units.length) return 0;
        let items = [];
        try {
            const response = await fetch(`/api/script/library-videos?library_id=${encodeURIComponent(scriptAssetLibraryId)}`, { cache: 'no-store' });
            if (!response.ok) return 0;
            items = (await response.json()).items || [];
        } catch (error) {
            // 素材库读不到就当没有，不影响正常生成
            return 0;
        }
        let matched = 0;
        units.forEach((unit) => {
            if (unit.run && unit.run.status === 'succeeded') return;
            // 同一个分镜在库里可能躺着好几条（重跑过的），取最新那条
            const picked = items
                .filter((item) => unitLibraryMatched(unit, item.name))
                .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];
            if (!picked) return;
            normalizeUnitRuns(unit);
            if (unit.run) unit.runHistory = [unit.run].concat(unit.runHistory || []);
            unit.run = {
                id: newRunId(),
                createdAt: picked.created_at || Date.now(),
                status: 'succeeded',
                progress: '',
                outputs: [{ url: picked.url, kind: 'video', inLibrary: true }],
                error: '',
            };
            matched += 1;
        });
        if (matched) {
            renderResults();
            saveStoryboardState();
        }
        return matched;
    }

    // 早先跑出来、还没进过素材库的成片，进入页面时一并补存（历次版本都补）
    function saveMissingUnitRuns() {
        const result = runnableResult();
        ((result && result.units) || []).forEach((unit) => {
            unitVersions(unit).forEach((run) => { saveUnitRunToLibrary(unit, run); });
        });
    }

    // 参考图生出来时会按条目名存进素材库（人物进「角色」、场景进「场景」）。
    // 换了浏览器、换台机器，或者本地这份参考图记录被清过之后，手上这条条目可能
    // 明明库里有图却不认识。这里按条目名去库里认一张回来，卡片上的「关联素材」就能显示。
    // 只认名字完全对得上的，宁可少认也不认错。
    // 库里早先存下的条目名可能还带着「· 概念图」这类规格后缀，两边都按同样规则
    // 去掉后缀再比，老条目也还认得出来。
    function castLibraryKey(text) {
        return castItemTitle(String(text || '')).replace(/\s+/g, ' ').trim().toLowerCase();
    }

    // 认领要跨所有素材库，这个索引不小（本机上千条）；连着触发时复用几秒内的结果
    let castLibraryCache = { at: 0, libraries: [] };

    async function castLibraryGroups() {
        const now = Date.now();
        if (castLibraryCache.libraries.length && now - castLibraryCache.at < 5000) {
            return castLibraryCache.libraries;
        }
        const response = await fetch('/api/asset-library', { cache: 'no-store' });
        if (!response.ok) return [];
        const data = await response.json();
        const libraries = ((data.library || {}).libraries || []);
        castLibraryCache = { at: now, libraries };
        return libraries;
    }

    async function matchCastLibraryImages() {
        const entries = allCastEntries();
        if (!entries.length) return 0;
        const groups = [];
        const foreignNames = [];
        try {
            // 只认本剧本自己的素材库：别的剧本就算撞上同名角色也不能拿来用，
            // 否则两个剧本的画面会串在一起（比如新剧本的角色顶着上一个剧本的参考图）。
            (await castLibraryGroups()).forEach((library) => {
                if (library.id !== scriptAssetLibraryId) {
                    // 别的剧本的库名先记下来：下面要靠它把已经混进来的旧引用清掉
                    if (library.name) foreignNames.push(String(library.name));
                    return;
                }
                (library.categories || []).forEach((cat) => {
                    const kind = /道具|prop/i.test(String(cat.name || ''))
                        ? 'prop'
                        : (/场景|scene/i.test(String(cat.name || '')) ? 'scene' : 'character');
                    ((cat.items) || []).forEach((item) => { groups.push({ kind, item }); });
                });
            });
        } catch (error) {
            // 素材库读不到就当没有，不影响正常生成
            return 0;
        }
        // 只看不认还不够：浏览器里存着的那份旧快照可能还指着别的剧本的图，
        // 每次认领时顺手清一遍，免得刷新页面又把混用的图恢复回来。
        let pruned = 0;
        Object.keys(state.castShots).forEach((key) => {
            const url = String((state.castShots[key] || {}).url || '');
            if (!url) return;
            const mixed = foreignNames.some((name) => url.includes(`/assets/library/${name}/`)
                || url.includes(`/assets/library/${encodeURIComponent(name)}/`));
            if (!mixed) return;
            delete state.castShots[key];
            pruned += 1;
        });
        if (pruned) saveCastState();
        let matched = 0;
        entries.forEach(({ item, index }) => {
            // 已经有对得上的图了就不动它
            if (castShotOf(item, index)) return;
            const wanted = castLibraryKey(item.title);
            if (!wanted) return;
            const picked = groups
                .filter((row) => row.kind === item.kind && castLibraryKey(row.item.name) === wanted)
                // 同一档里取最新的一张
                .sort((a, b) => ((b.item.created_at || 0) - (a.item.created_at || 0)))[0];
            if (!picked) return;
            state.castShots[castShotKey(item, index)] = {
                status: 'done',
                prompt: item.prompt,
                url: picked.item.url,
                error: '',
                inLibrary: true,
            };
            matched += 1;
        });
        if (matched) {
            syncCastGallery();
            refreshUnitRefs();
            saveCastState();
        }
        return matched;
    }

    // 版本号排成一行：点哪一版就把哪一版作为当前版；两版以上还给一个「对比」开关
    function unitVersionsHtml(unit, unitIndex, episodeIndex) {
        const list = unitVersions(unit);
        if (list.length < 2) return '';
        const chips = list.map((run, position) => {
            const active = run === unit.run;
            const failed = run.status === 'failed';
            const label = tf('script.comfyVersionNo', { n: position + 1 });
            const title = failed ? `${label} · ${tr('script.failed')}：${run.error || ''}` : label;
            return `<button class="version-chip${active ? ' active' : ''}${failed ? ' failed' : ''}"
                data-action="unit-version" data-episode="${episodeIndex}" data-unit="${unitIndex}"
                data-version="${esc(run.id)}" title="${esc(title)}"
                aria-pressed="${active ? 'true' : 'false'}">${esc(label)}</button>`;
        }).join('');
        const open = unitCompareOpen.has(unit);
        return `<div class="unit-versions">
            <span class="unit-versions-count">${esc(tf('script.comfyVersionCount', { n: list.length }))}</span>
            ${chips}
            <button class="version-chip compare${open ? ' active' : ''}"
                data-action="unit-compare" data-episode="${episodeIndex}" data-unit="${unitIndex}"
                aria-pressed="${open ? 'true' : 'false'}">${esc(tr(open ? 'script.comfyVersionCompareClose' : 'script.comfyVersionCompare'))}</button>
        </div>`;
    }

    // 对比：把每一版都摊出来，各自独立播放，能并排着看
    function unitCompareHtml(unit) {
        if (!unitCompareOpen.has(unit)) return '';
        const items = unitVersions(unit).map((run, position) => {
            const label = tf('script.comfyVersionNo', { n: position + 1 });
            const media = (run.outputs || []).filter((item) => item.kind !== 'image');
            let body = '';
            if (run.status === 'failed') body = `<div class="unit-compare-note failed">${esc(tr('script.failed'))}：${esc(run.error || '')}</div>`;
            else if (media.length) body = media.map(mediaHtml).join('');
            else body = `<div class="unit-compare-note">${esc(tr('script.comfyNoOutput'))}</div>`;
            return `<div class="unit-compare-item${run === unit.run ? ' active' : ''}">
                <div class="unit-compare-label">${esc(label)}</div>${body}
            </div>`;
        }).join('');
        return `<div class="unit-compare">${items}</div>`;
    }

    function unitRunHtml(unit, unitIndex, episodeIndex) {
        const run = unit.run;
        if (!run) return '';
        // 这一版跑在哪台主机上（多台时能看出是不是分散着跑）
        const host = run.backend ? ` · ${tf('script.comfyHost', { host: run.backend })}` : '';
        if (run.status === 'running') {
            const progress = run.progress ? ` · ${esc(run.progress)}` : '';
            return `<div class="unit-run">${esc(tr('script.comfyRunning'))}${esc(host)}${progress}</div>`;
        }
        // 失败的那一版下面也要有版本条：好点回上一版接着用
        const versions = unitVersionsHtml(unit, unitIndex, episodeIndex);
        if (run.status === 'failed') {
            return `<div class="unit-run failed">${esc(tr('script.failed'))}：${esc(run.error)}${esc(host)}</div>${versions}${unitCompareHtml(unit)}`;
        }
        // 出过片的把成片直接摆出来：只留版本条的话，卡片上看不出这一段到底有没有片，
        // 还得跑去素材库才知道。缩略用 CSS 限高，一页 20 张也压得住。
        const media = (run.outputs || []).filter((item) => item && item.kind !== 'image');
        const player = media.length
            ? `<div class="unit-run-media">${media.map(mediaHtml).join('')}</div>`
            : '';
        // 这一版是在旧素材下跑的：补了新的人物 / 场景图，得重跑
        const stale = run.staleRefs
            ? `<div class="unit-run-stale">${esc(tr('script.unitStaleRefs'))}</div>`
            : '';
        const extra = `${stale}${player}${versions}${unitCompareHtml(unit)}`;
        return extra ? `<div class="unit-run">${extra}</div>` : '';
    }

    function mediaHtml(item) {
        const url = esc(item.url || '');
        if (!url) return '';
        if (item.kind === 'video') return `<video src="${url}" controls preload="metadata"></video>`;
        if (item.kind === 'audio') return `<audio src="${url}" controls></audio>`;
        if (item.kind === 'image') return `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="" loading="lazy"></a>`;
        return `<a href="${url}" target="_blank" rel="noopener">${url}</a>`;
    }

    // 只刷新单个单元的运行结果，避免轮询期间整块重绘打断已完成的视频播放
    function refreshUnitRun(unit) {
        const result = state.results[0];
        if (!result) return;
        const index = (result.units || []).indexOf(unit);
        if (index < 0) return;
        const slot = document.querySelector(`[data-unit-run="${index}"]`);
        if (slot) slot.innerHTML = unitRunHtml(unit, index, result.index);
        // 正在跑的这一条，它自己卡片上的「运行」按钮点不动，免得同一段提交两次；
        // 已经出过片的，按钮改成「重新生成」
        const button = document.querySelector(`[data-unit-card="${index}"] button[data-action="run-unit"]`);
        if (button) {
            button.disabled = Boolean(unit.run && unit.run.status === 'running');
            button.textContent = tr(unit.run && unit.run.status === 'succeeded' ? 'script.comfyRerun' : 'script.comfyRunOne');
        }
        saveStoryboardState();
    }

    // ---------- 导出 / 保存 ----------
    function allMarkdown() {
        const result = finishedResult();
        if (!result) return '';
        return [`# ${tr('script.title')}`, '', episodeMarkdown(result)].join('\n').trim();
    }

    function allUnits() {
        const result = finishedResult();
        if (!result) return [];
        return (result.units || []).map((unit) => ({
            name: `${unit.code}${unit.name ? ' ' + unit.name : ''}`,
            prompt: unitText(unit),
            scene: unit.name || '',
            category: 'custom',
        }));
    }

    async function saveToLibrary() {
        const items = allUnits();
        if (!items.length) {
            toast(tr('script.needResult'));
            return;
        }
        const button = $('saveLibraryBtn');
        button.disabled = true;
        try {
            const response = await fetch('/api/script/save-to-library', {
                method: 'POST',
                headers: jsonHeaders,
                body: JSON.stringify({ library_id: '', items }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
            toast(tf('script.savedCount', { n: (data.items || []).length }));
        } catch (error) {
            toast(String(error.message || error));
        } finally {
            button.disabled = false;
        }
    }

    // ---------- 分镜提示词保存到本机 ----------
    // 浏览器里那份 localStorage 一清就没了，这里把整份分镜（提示词 + 断点 + 成片记录）
    // 存到本机的数据文件里（data/script_storyboards.json），随时能加载回来接着用。
    function storyboardLibraryHtml(items) {
        if (!items.length) return `<div class="muted">${esc(tr('script.sbEmpty'))}</div>`;
        return items.map((item) => `
            <div class="sb-row">
                <div class="sb-meta">
                    <div class="sb-name">${esc(item.name)}</div>
                    <div class="muted">${esc(tf('script.sbInfo', {
                        n: item.unit_count,
                        done: item.with_runs,
                        time: shortTime(item.saved_at),
                    }))}</div>
                </div>
                <div class="row">
                    <button class="btn btn-primary" data-sb-load="${esc(item.id)}">${esc(tr('script.sbLoad'))}</button>
                    <button class="btn" data-sb-delete="${esc(item.id)}">${esc(tr('script.sbDelete'))}</button>
                </div>
            </div>
        `).join('');
    }

    async function refreshStoryboardLibrary() {
        const box = $('storyboardLib');
        if (!box) return;
        box.innerHTML = `<div class="muted">${esc(tr('script.sbLoading'))}</div>`;
        try {
            const response = await fetch('/api/script/storyboards', { cache: 'no-store' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
            box.innerHTML = storyboardLibraryHtml(data.items || []);
        } catch (error) {
            box.innerHTML = `<div class="muted">${esc(String(error.message || error))}</div>`;
        }
    }

    async function toggleStoryboardLibrary() {
        const box = $('storyboardLib');
        if (!box) return;
        const open = box.hidden;
        box.hidden = !open;
        if (open) await refreshStoryboardLibrary();
    }

    // 保存到本机：默认名字带上分镜编号范围，用户可以改成自己认得出的
    async function saveStoryboardToLocal() {
        const snapshot = storyboardSnapshot();
        const units = snapshot.results.reduce((all, item) => all.concat((item && item.units) || []), []);
        if (!units.length) {
            toast(tr('script.needResult'));
            return;
        }
        const codes = units.map((unit) => unit.code).filter(Boolean);
        const range = codes.length ? `${codes[0]}${codes.length > 1 ? '-' + codes[codes.length - 1] : ''}` : 'P01';
        const name = window.prompt(tr('script.sbNamePrompt'), `${range} · ${stamp()}`);
        if (name === null) return;
        const button = $('saveStoryboardBtn');
        button.disabled = true;
        try {
            const response = await fetch('/api/script/storyboards', {
                method: 'POST',
                headers: jsonHeaders,
                body: JSON.stringify({ name: String(name).trim(), ...snapshot }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
            toast(tf('script.sbSaved', { n: (data.item || {}).unit_count || units.length }));
            if (!$('storyboardLib').hidden) await refreshStoryboardLibrary();
        } catch (error) {
            toast(String(error.message || error));
        } finally {
            button.disabled = false;
        }
    }

    // 加载回来：整份替换掉当前的分镜（含断点），刷新视图即可继续跑分镜、接着生成后续分段
    async function loadStoryboardFromLocal(id) {
        // 正在生成或正在跑分镜时不换，免得两批数据混在一起
        if (state.running || unitRunPool.running) {
            toast(tr('script.comfyBusy'));
            return;
        }
        try {
            const response = await fetch(`/api/script/storyboards/${encodeURIComponent(id)}`, { cache: 'no-store' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
            applyStoryboardState(data.results, data.session);
            renderResults();
            // 断点带回来了，按钮要跟着变成「继续生成」，不然要刷新一次页面才认出来
            setRunningUI(false);
            $('storyboardLib').hidden = true;
            toast(tf('script.sbLoaded', { n: (data.item || {}).unit_count || 0 }));
        } catch (error) {
            toast(String(error.message || error));
        }
    }

    async function deleteStoryboardFromLocal(id) {
        if (!window.confirm(tr('script.sbDeleteConfirm'))) return;
        try {
            const response = await fetch(`/api/script/storyboards/${encodeURIComponent(id)}`, { method: 'DELETE' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
            await refreshStoryboardLibrary();
        } catch (error) {
            toast(String(error.message || error));
        }
    }

    // 导入的文件认两种：这里「导出 JSON」出来的那一份（只有 units），以及整份分镜快照
    // （results + session，带断点）。前者当一份结果接上，后者原样接。
    function importedResults(data) {
        if (Array.isArray(data && data.results)) {
            return data.results.filter((item) => item && typeof item === 'object');
        }
        if (Array.isArray(data && data.units)) {
            return [{
                index: 0,
                title: data.title || tr('script.result'),
                status: 'done',
                outline: data.outline || '',
                error: '',
                raw: data.raw || '',
                units: data.units.filter((unit) => unit && typeof unit === 'object'),
            }];
        }
        return [];
    }

    // 导入分镜提示词：整份替换掉当前分镜，导入完照样能改、能跑、能存到本机
    function importStoryboardFile(file) {
        if (!file) return;
        // 正在生成或正在跑分镜时不换，免得两批数据混在一起
        if (state.running || unitRunPool.running) {
            toast(tr('script.comfyBusy'));
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            let data = null;
            try {
                data = JSON.parse(String(reader.result || ''));
            } catch (error) {
                toast(tf('script.sbImportBad', { name: file.name }));
                return;
            }
            const results = importedResults(data);
            const count = results.reduce((all, item) => all + ((item.units || []).length), 0);
            if (!count) {
                toast(tf('script.sbImportBad', { name: file.name }));
                return;
            }
            applyStoryboardState(results, data && data.session);
            // renderResults 里会顺手把这份写回 localStorage
            renderResults();
            setRunningUI(false);
            toast(tf('script.sbImported', { n: count }));
        };
        reader.onerror = () => toast(tf('script.sbImportBad', { name: file.name }));
        reader.readAsText(file, 'utf-8');
    }

    // 从提示词库整批加载分镜：库里的单元提示词用编号命名（P1230 你来了），
    // 把 P 开头的条目按编号顺排成一份分镜，接进结果区，之后照样能跑、能存、能导出。
    const LIBRARY_UNIT_NAME_RE = /^\s*[Pp]\s*\d{1,4}\b/;

    function libraryUnitFromItem(item) {
        const raw = String(item.name || '').trim();
        const match = raw.match(/^\s*[Pp]\s*\d{1,4}/);
        return {
            code: match ? match[0].replace(/\s+/g, '').toUpperCase() : '',
            duration: '',
            name: String(item.scene || '').trim() || raw.slice(match ? match[0].length : 0).trim(),
            prompt: String(item.positive || '').trim(),
        };
    }

    // 编号按数字大小顺排（P01 → P1230），没有编号的排到最后
    function libraryUnitOrder(unit) {
        const num = Number(String(unit.code || '').replace(/[^\d]/g, ''));
        return Number.isFinite(num) && num > 0 ? num : Number.MAX_SAFE_INTEGER;
    }

    async function loadUnitsFromLibrary() {
        // 正在生成或正在跑分镜时不换，免得两批数据混在一起
        if (state.running || unitRunPool.running) {
            toast(tr('script.comfyBusy'));
            return;
        }
        const button = $('loadLibraryUnitsBtn');
        button.disabled = true;
        try {
            const response = await fetch('/api/prompt-libraries', { cache: 'no-store' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
            const units = (data.library?.libraries || [])
                .flatMap((lib) => (lib && lib.items) || [])
                .filter((item) => item && item.positive && LIBRARY_UNIT_NAME_RE.test(String(item.name || '')))
                .map(libraryUnitFromItem)
                .sort((a, b) => libraryUnitOrder(a) - libraryUnitOrder(b));
            if (!units.length) {
                toast(tr('script.sbLibraryEmpty'));
                return;
            }
            applyStoryboardState([{
                index: 0,
                title: tr('script.sbLibraryTitle'),
                status: 'done',
                outline: '',
                units,
                raw: '',
                error: '',
            }], null);
            // 新的一份分镜从第一页看起
            state.unitsPage = {};
            // renderResults 里会顺手把这份写回 localStorage 和剧本文件
            renderResults();
            setRunningUI(false);
            toast(tf('script.sbLibraryLoaded', { n: units.length }));
        } catch (error) {
            toast(String(error.message || error));
        } finally {
            button.disabled = false;
        }
    }

    // ---------- 对话补分镜 ----------
    // 在已有分镜的基础上跟模型对话，只补写新的那几条分镜提示词：结果先在对话里预览，
    // 再由用户点某张分镜卡片上的「在此处插入」决定插到哪儿。
    // 插入用「子编号」：插在第一张前面叫 P00，插在 P01 与 P02 之间叫 P01B。
    // 已有的 P 号一律不动 —— 它们对应素材库里按编号命名的成片，一改就认不回来了。

    function chatDraftCount() {
        return (state.chatDraft || []).length;
    }

    function chatUnitHtml(unit) {
        const head = [unit.duration, unit.name].filter(Boolean).map(esc).join(' · ');
        return `<div class="chat-unit">
            <div class="chat-unit-head"><span class="title">${esc(unit.code || '')}</span><span class="sub">${head}</span></div>
            ${unitNarrationHtml(unit)}
            <pre>${esc(unit.prompt || '')}</pre>
        </div>`;
    }

    function renderChatLog() {
        const box = $('chatLog');
        if (!box) return;
        if (!state.chatMessages.length) {
            box.innerHTML = `<div class="muted">${esc(tr('script.chatEmpty'))}</div>`;
            return;
        }
        box.innerHTML = state.chatMessages.map((msg) => {
            if (msg.role === 'user') {
                return `<div class="chat-msg chat-me">
                    <div class="chat-who">${esc(tr('script.chatYou'))}</div>
                    <div class="chat-text">${esc(msg.content || '')}</div>
                </div>`;
            }
            const units = msg.units || [];
            const body = units.length
                ? `<div class="chat-units">${units.map(chatUnitHtml).join('')}</div>
                   <div class="muted chat-draft-hint">${esc(tf('script.chatDraftHint', { n: units.length }))}</div>`
                : `<div class="chat-text">${esc(msg.text || '')}</div>`;
            return `<div class="chat-msg chat-ai">
                <div class="chat-who">${esc(tr('script.chatModel'))}</div>${body}
            </div>`;
        }).join('');
        box.scrollTop = box.scrollHeight;
    }

    function setChatUI(running) {
        if ($('chatSendBtn')) $('chatSendBtn').disabled = running;
        if ($('chatInput')) $('chatInput').disabled = running;
        if ($('chatStopBtn')) $('chatStopBtn').hidden = !running;
        if ($('chatStatus')) $('chatStatus').textContent = running ? tr('script.generating') : '';
    }

    function toggleChatPanel(force) {
        const panel = $('storyboardChat');
        if (!panel) return;
        // 和「加载分镜」那处同规则：hidden 为真说明现在是收起的
        const show = typeof force === 'boolean' ? force : panel.hidden;
        panel.hidden = !show;
        if (show) {
            renderChatLog();
            $('chatInput').focus();
        }
    }

    async function sendChatMessage() {
        if (state.chatRunning) return;
        const input = $('chatInput');
        const text = String((input && input.value) || '').trim();
        if (!text) return;
        if (!scriptContent()) {
            toast(tr('script.needText'));
            return;
        }
        state.chatMessages.push({ role: 'user', content: text });
        input.value = '';
        const reply = { role: 'assistant', text: '', units: [] };
        state.chatMessages.push(reply);
        renderChatLog();
        state.chatRunning = true;
        state.chatController = new AbortController();
        setChatUI(true);
        try {
            const result = state.results[0];
            const units = (((result || {}).units) || []).map((unit) => ({ code: unit.code || '', name: unit.name || '' }));
            // 除最后这两句以外的都是历史轮次，「再短一点」这种追问才接得上
            const history = state.chatMessages.slice(0, -2)
                .map((msg) => ({ role: msg.role, content: msg.content || msg.text || '' }))
                .filter((msg) => msg.content);
            const response = await fetch('/api/script/chat-storyboard', {
                method: 'POST',
                headers: jsonHeaders,
                signal: state.chatController.signal,
                body: JSON.stringify({ ...buildRequestBody(), units, instruction: text, history }),
            });
            if (!response.ok) {
                const detail = await response.json().catch(() => ({}));
                throw new Error(detail.detail || `HTTP ${response.status}`);
            }
            await consumeStream(response, (event) => {
                if (event.type === 'delta') {
                    reply.text += event.text || '';
                    renderChatLog();
                } else if (event.type === 'chat_done') {
                    reply.units = event.units || [];
                    reply.text = event.raw || reply.text;
                } else if (event.type === 'chat_error') {
                    throw new Error(event.detail || tr('script.failed'));
                }
            });
            state.chatDraft = reply.units || [];
            renderChatLog();
            // 有草稿就把每张卡片上的「在此处插入」显示出来
            renderResults();
            if (!state.chatDraft.length && !String(reply.text || '').trim()) {
                toast(tr('script.chatNoUnits'));
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                reply.text = reply.text || tr('script.chatStopped');
            } else {
                reply.text = `${tr('script.failed')}：${String(error.message || error)}`;
                toast(String(error.message || error));
            }
            renderChatLog();
        } finally {
            state.chatRunning = false;
            state.chatController = null;
            setChatUI(false);
        }
    }

    // 给新分镜编「子编号」，不与现有编号冲突：
    // 插在第一张前面 → P00、P00B…；插在 P01 之后 → P01B、P01C…
    function nextInsertCodes(units, index, count) {
        const taken = new Set((units || []).map((unit) => String(unit.code || '').toUpperCase()));
        const first = String(((units || [])[0] || {}).code || 'P01');
        const firstNum = Number((first.match(/\d+/) || [])[0] || 1);
        const prev = index > 0 ? String((units[index - 1] || {}).code || '') : '';
        const base = prev || `P${String(Math.max(0, firstNum - 1)).padStart(2, '0')}`;
        const codes = [];
        let letter = 0;
        while (codes.length < count) {
            const code = base + (letter === 0 ? '' : String.fromCharCode(64 + letter));
            letter += 1;
            if (taken.has(code.toUpperCase())) continue;
            taken.add(code.toUpperCase());
            codes.push(code);
        }
        return codes;
    }

    // 把对话产出的新分镜插到第 index 张卡片前面
    function insertChatUnits(index) {
        const draft = state.chatDraft || [];
        if (!draft.length) {
            toast(tr('script.chatNeedDraft'));
            return;
        }
        const result = state.results[0];
        if (!result) return;
        const units = result.units || (result.units = []);
        const at = Math.max(0, Math.min(Number(index) || 0, units.length));
        const codes = nextInsertCodes(units, at, draft.length);
        const prepared = draft.map((unit, i) => ({ ...unit, code: codes[i] }));
        units.splice(at, 0, ...prepared);
        state.chatDraft = [];
        state.unitsPage = {};
        renderChatLog();
        renderResults();
        toast(tf('script.chatInserted', { n: prepared.length }));
    }

    // ---------- 补齐过渡分镜 ----------
    // 相邻两张分镜之间剧情/画面跳跃（换时间、换地方、动作断裂）时，模型看不出中间怎么过去的。
    // 这里分批把相邻分镜交给模型，让它只在真正缺过渡的地方补一条过渡镜头，直接插进结果。
    const BRIDGE_BATCH = 16;   // 一批送多少张分镜（相邻两两配对，一批能看 15 个接缝）

    const BRIDGE_INSTRUCTION = [
        '这次不要按剧本重拆，也不要重排编号——只做一件事：',
        '在我给出的这一批分镜里，找出**相邻两张之间剧情或画面跳跃、缺一个过渡镜头**的位置，只为这些位置补写过渡分镜。',
        '',
        '该补的情况（满足任意一条即可）：',
        '- 时间跳跃：上一镜还是白天/某个时刻，下一镜已经入夜或换了时刻，中间没有交代',
        '- 空间跳跃：上一镜在这个场景，下一镜人已经在另一个地方，中间没有交代移动过程',
        '- 动作断裂：上一镜还在做/刚说完，下一镜一件事已经做完、人已经换了位置，中间过程缺失',
        '- 情绪或关系突变：没有铺垫就翻脸、认输、昏迷、突然转变态度',
        '',
        '不该补的情况（宁可少补，也不要硬塞）：',
        '- 相邻两镜本来就是连续动作，或者对话接对话',
        '- 只是景别变化（远景切近景、切特写）',
        '- 你只是觉得「再加一个镜头更好看」',
        '',
        '补出来的过渡分镜要求：',
        '- 每条只写一个单元，时长按所选分镜模板的规则来（各条按内容长短取不同值，不要都写同一个数），容量按模板里的规则算',
        '- **段名必须以「补在P编号之后 · 」开头**，P编号写它要插在后面的那一张的编号：'
        + '例如要补在 P13 和 P14 之间，段名就写成 `补在P13之后 · 走出教室`',
        '- 过渡镜头必须是能拍出来的具体动作或转场（走位、交接、光线变化、时间流逝、道具遮挡），'
        + '不要空镜、不要纯风景',
        '- 画面风格段、固定尾缀、负面词与字段顺序，跟这一批已有分镜逐字一致',
        '',
        '如果这一批里没有任何位置需要过渡，就只回一句「无需过渡」，不要输出任何代码块。',
    ].join('\n');

    // 所有结果里的分镜按拍摄顺序拉平
    function orderedScriptUnits() {
        const out = [];
        (state.results || []).forEach((result, resultIndex) => {
            ((result || {}).units || []).forEach((unit, unitIndex) => {
                out.push({ result, resultIndex, unitIndex, unit });
            });
        });
        return out;
    }

    // 按编号找某一张分镜落在哪个结果里（插入会把下标顶走，所以每次都重新按编号定位）
    function findScriptUnitByCode(code) {
        const want = String(code || '').toUpperCase();
        if (!want) return null;
        for (const result of state.results || []) {
            const units = (result || {}).units || [];
            const index = units.findIndex((unit) => String((unit || {}).code || '').toUpperCase() === want);
            if (index >= 0) return { units, index };
        }
        return null;
    }

    // 把模型补出来的过渡分镜按「补在P13之后」插到 P13 后面，编号沿用 P13B、P13C 这套子编号
    function insertBridgeUnits(draft) {
        let inserted = 0;
        (draft || []).forEach((unit) => {
            const name = String((unit || {}).name || '');
            const matched = name.match(/补在\s*(P\d+[A-Za-z]?)\s*之后/);
            if (!matched) return;
            const spot = findScriptUnitByCode(matched[1]);
            if (!spot) return;
            const [code] = nextInsertCodes(spot.units, spot.index + 1, 1);
            const cleanName = name.replace(/^补在\s*P\d+[A-Za-z]?\s*之后\s*[·、,，:：]?\s*/, '').trim();
            spot.units.splice(spot.index + 1, 0, {
                code,
                duration: unit.duration || 12,
                name: cleanName || name,
                prompt: unit.prompt || '',
                raw: unit.raw || '',
                run: null,
            });
            inserted += 1;
        });
        return inserted;
    }

    async function bridgeStoryboard() {
        if (state.running || state.bridgeRunning) return;
        const all = orderedScriptUnits();
        if (all.length < 2) {
            toast(tr('script.bridgeTooFew'));
            return;
        }
        const calls = Math.ceil((all.length - 1) / (BRIDGE_BATCH - 1));
        if (!window.confirm(tf('script.bridgeConfirm', { n: all.length, calls }))) return;
        state.bridgeRunning = true;
        state.bridgeNote = tf('script.bridgeProgress', { done: 0, total: calls });
        state.bridgeAbort = new AbortController();
        renderResults();
        let inserted = 0;
        let unplaced = 0;
        let done = 0;
        try {
            for (let start = 0; start + 1 < all.length; start += BRIDGE_BATCH - 1) {
                if (state.bridgeAbort.signal.aborted) break;
                const slice = all.slice(start, start + BRIDGE_BATCH);
                // 只送这一批相邻分镜的正文：判断「中间缺没缺过渡」看的正是上一镜的落点和下一镜的起点，
                // 不需要把整本剧本再塞一遍
                const units = slice.map(({ unit }) => ({
                    code: (unit || {}).code || '',
                    name: (unit || {}).name || '',
                    text: String(unit.prompt || unit.raw || ''),
                }));
                const response = await fetch('/api/script/chat-storyboard', {
                    method: 'POST',
                    headers: jsonHeaders,
                    signal: state.bridgeAbort.signal,
                    body: JSON.stringify({
                        ...buildRequestBody(),
                        script: '',
                        units,
                        instruction: BRIDGE_INSTRUCTION,
                        history: [],
                    }),
                });
                if (!response.ok) {
                    const detail = await response.json().catch(() => ({}));
                    throw new Error(detail.detail || `HTTP ${response.status}`);
                }
                let draft = [];
                await consumeStream(response, (event) => {
                    if (event.type === 'chat_done') {
                        draft = event.units || [];
                    } else if (event.type === 'chat_error') {
                        throw new Error(event.detail || tr('script.failed'));
                    }
                });
                const added = insertBridgeUnits(draft);
                inserted += added;
                if (draft.length > added) unplaced += draft.length - added;
                done += 1;
                state.bridgeNote = tf('script.bridgeProgress', { done, total: calls });
                state.unitsPage = {};
                renderResults();
                saveStoryboardState();
            }
            toast(tf('script.bridgeDone', { n: inserted }));
            // 模型没按「补在P编号之后」写段名时插不进去，得说一声，免得以为补了其实没补
            if (unplaced) toast(tf('script.bridgeUnplaced', { n: unplaced }));
        } catch (error) {
            if (error.name === 'AbortError') {
                toast(tf('script.bridgeStopped', { n: inserted }));
            } else {
                toast(`${tr('script.failed')}：${String(error.message || error)}`);
            }
        } finally {
            state.bridgeRunning = false;
            state.bridgeAbort = null;
            state.bridgeNote = '';
            renderResults();
            saveStoryboardState();
            flushScriptProject({ force: true });
        }
    }

    function shortTime(ms) {
        const date = new Date(Number(ms) || 0);
        if (Number.isNaN(date.getTime())) return '';
        const pad = (value) => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    // ---------- 事件绑定 ----------
    function bindEvents() {
        const dropZone = $('dropZone');
        const fileInput = $('fileInput');

        // 生成中刷新或关掉页面会把这一轮打断（落盘时状态被改成「已暂停」），
        // 所以拦一道确认框；没在跑的时候不打扰
        window.addEventListener('beforeunload', (event) => {
            if (!state.running && !unitRunPool.running) return undefined;
            // 走之前补一次落盘：正在流的那段文字只在内存里，存进「中断那一段没写完的原文」
            // 还能看到已经生成的部分（这一段本身还在断点队列里，下次会补跑）
            const result = state.results[0];
            if (result && state.live) result.partialRaw = state.live;
            saveStoryboardState();
            event.preventDefault();
            event.returnValue = tr('script.refreshWarn');
            return tr('script.refreshWarn');
        });

        dropZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
            readFile(fileInput.files && fileInput.files[0]);
            fileInput.value = '';
        });
        ['dragenter', 'dragover'].forEach((type) => dropZone.addEventListener(type, (event) => {
            event.preventDefault();
            dropZone.classList.add('over');
        }));
        ['dragleave', 'drop'].forEach((type) => dropZone.addEventListener(type, (event) => {
            event.preventDefault();
            dropZone.classList.remove('over');
        }));
        dropZone.addEventListener('drop', (event) => {
            const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
            readFile(file);
        });

        $('scriptText').addEventListener('input', () => {
            updateScriptSummary();
            scheduleCastSave();
        });
        let castSyncTimer = null;
        $('clearBtn').addEventListener('click', () => {
            $('scriptText').value = '';
            // 人物与场景是从剧本里提取的，剧本清空后一起失效
            setCastText('', '');
            $('castStatus').textContent = '';
            state.castShots = {};
            state.results = [];
            // 断点跟着剧本一起作废，否则清空后还能从旧队列接着生成
            state.session = null;
            // PenShot 是基于剧本正文跑的，正文清空后结果一并作废
            applyPenshotState(null);
            // 技能提取也是基于剧本正文跑的，正文清空后结果一并作废
            applyShotSkillState(null);
            // 这次是用户明确要清空，允许这一份保存把已有的分镜整份清掉
            allowClearOnce = true;
            updateScriptSummary();
            syncCastGallery();
            syncGenerateEnabled();
            renderResults();
        });

        $('castTemplateSelect').addEventListener('change', (event) => {
            state.castTemplateId = event.target.value;
        });
        // 画风是整片定调：人物/场景/道具那步与 PenShot 那步两个下拉同源，改哪个都同步并顺手存档
        const onScriptStyleChange = (event) => {
            state.styleId = event.target.value;
            renderCastStyleOptions();
            renderPenshotStyleOptions();
            scheduleScriptProjectSave();
        };
        $('castStyleSelect').addEventListener('change', onScriptStyleChange);
        $('penshotStyleSelect').addEventListener('change', onScriptStyleChange);
        $('castGenerateBtn').addEventListener('click', () => generateCast());
        // 只补道具：不会碰人物与场景，已经出好的参考图照旧
        $('castPropGenerateBtn').addEventListener('click', () => generateCast('prop'));
        // 检查漏掉的条目：三类都生成过才显示，只追加新条目，已有的条目与参考图都不动
        $('castCheckMissingBtn').addEventListener('click', () => checkMissingCast());
        // 三组各自两个按钮：重出提示词（只改文字）、补齐缺失素材（只画还没有图的，已有的不动）
        CAST_KINDS.forEach((kind) => {
            $(CAST_REGEN_PROMPT_BUTTONS[kind]).addEventListener('click', () => generateCast(kind));
            $(CAST_REGEN_ASSET_BUTTONS[kind]).addEventListener('click', () => fillMissingCastAssets(kind));
        });
        $('castStopBtn').addEventListener('click', () => {
            if (state.castController) state.castController.abort();
        });
        // PenShot 管线：复用第 4 步选的平台/模型，只展示结果，不动人物/场景/分镜
        // 「生成」输入没变时直接读上次结果；「重新运行」永远强制从头跑一遍
        $('penshotRunBtn').addEventListener('click', () => submitPenshot(false));
        $('penshotRerunBtn').addEventListener('click', () => submitPenshot(true));
        $('penshotStopBtn').addEventListener('click', () => {
            if (state.penshotController) state.penshotController.abort();
        });
        // 第六步：选技能 + 用一个技能从当前剧本正文里提取分镜提示词（结果只追加进分镜列表）
        $('shotSkillSelect').addEventListener('change', (event) => {
            state.shotSkillId = event.target.value;
        });
        $('shotSkillRunBtn').addEventListener('click', () => runShotSkillExtract());
        // 改提取时长上限：随手存一下（0 = 提取全部）
        $('shotDurationLimit').addEventListener('change', () => {
            const input = $('shotDurationLimit');
            const value = Math.max(0, Math.round(Number(input.value) || 0));
            input.value = String(value);
            if (!state.shotSkill) state.shotSkill = shotSkillState(null);
            state.shotSkill.durationLimit = value;
            saveStoryboardState();
        });
        // 第 5 步卡片的「采用 / 切换历史 / 删除」按钮统一走事件委托
        $('penshotCard').addEventListener('click', (event) => {
            const button = event.target.closest('button[data-action]');
            if (!button) return;
            const action = button.dataset.action;
            if (action === 'penshot-history-pick') selectPenshotSnapshot(button.dataset.id);
            else if (action === 'penshot-delete-snapshot') deletePenshotSnapshot(button.dataset.id);
            else if (action === 'penshot-adopt-cast') adoptPenshotCast(button.dataset.kind, button.dataset.name);
            else if (action === 'penshot-adopt-all-cast') adoptPenshotCastAll(button.dataset.kind);
            else if (action === 'penshot-adopt-fragment') adoptPenshotFragment(button.dataset.id);
            else if (action === 'penshot-adopt-all-fragment') adoptAllPenshotFragments();
        });
        // 改提取时长上限：随手存一下（0 = 不限）
        $('penshotDurationLimit').addEventListener('change', () => {
            const input = $('penshotDurationLimit');
            const value = Math.max(0, Math.round(Number(input.value) || 0));
            input.value = String(value);
            if (state.penshot) state.penshot.durationLimit = value;
            saveStoryboardState();
        });
        // 实时采用开关：随手存一下
        $('penshotAutoAdopt').addEventListener('change', () => {
            const input = $('penshotAutoAdopt');
            if (state.penshot) state.penshot.autoAdopt = Boolean(input.checked);
            saveStoryboardState();
        });
        $('castCopyBtn').addEventListener('click', () => copyText(castAllText(), null));
        $('castDownloadBtn').addEventListener('click', () => {
            const content = castAllText();
            if (!content) {
                toast(tr('script.castEmpty'));
                return;
            }
            download(`character-scene-${stamp()}.md`, content, 'text/markdown;charset=utf-8');
        });
        ['castCharacters', 'castScenes', 'castProps'].forEach((id) => {
            $(id).addEventListener('input', () => {
                syncGenerateEnabled();
                clearTimeout(castSyncTimer);
                castSyncTimer = setTimeout(() => {
                    syncCastGallery();
                    // 手粘进来的设定也一样：同名条目去素材库里认领旧图
                    matchCastLibraryImages().catch(() => {});
                }, 300);
            });
        });

        $('castGallery').addEventListener('click', (event) => {
            const toggle = event.target.closest('[data-cast-toggle]');
            if (toggle) {
                const kind = toggle.dataset.castToggle;
                state.castCollapsed[kind] = !state.castCollapsed[kind];
                renderCastGallery();
                saveCastState();
                return;
            }
            const redoPrompt = event.target.closest('[data-cast-redo-prompt]');
            if (redoPrompt) {
                redoCastItemPrompt(redoPrompt.dataset.castRedoPrompt);
                return;
            }
            const button = event.target.closest('[data-cast-run]');
            if (!button) return;
            const entry = findCastEntry(button.dataset.castRun);
            if (entry) runCastShots([entry]);
        });
        $('castImageEngineSelect').addEventListener('change', (event) => {
            state.imageEngine = event.target.value;
            renderCastImageEngine();
            updateCastImageStatus();
            saveCastState();
        });
        CAST_COMFY_KINDS.forEach((kind) => {
            const select = $(CAST_COMFY_SELECT_ID[kind]);
            if (!select) return;
            select.addEventListener('change', (event) => {
                state.castComfyWorkflowByKind = { ...(state.castComfyWorkflowByKind || {}), [kind]: event.target.value };
                saveCastComfyWorkflows();
                refreshCastSizeSupport();
                updateCastImageStatus();
            });
        });
        $('imageProviderSelect').addEventListener('change', (event) => {
            state.imageProviderId = event.target.value;
            renderImageModels();
            updateCastImageStatus();
        });
        $('imageModelSelect').addEventListener('change', (event) => {
            state.imageModel = event.target.value;
        });
        $('imageRatioSelect').addEventListener('change', (event) => {
            state.imageRatio = event.target.value;
        });
        $('imageResolutionSelect').addEventListener('change', (event) => {
            state.imageResolution = event.target.value;
        });
        $('castCharacterAllBtn').addEventListener('click', () => runCastKind('character'));
        $('castSceneAllBtn').addEventListener('click', () => runCastKind('scene'));
        $('castPropAllBtn').addEventListener('click', () => runCastKind('prop'));
        $('castImageStopBtn').addEventListener('click', () => { state.imageAbort = true; });

        $('templateSelect').addEventListener('change', (event) => {
            if (!event.target.value) return;
            state.templateId = event.target.value;
            applyTemplateToEditor();
        });
        $('toggleTemplateBtn').addEventListener('click', () => {
            const editor = $('templateEditor');
            editor.hidden = !editor.hidden;
            $('toggleTemplateBtn').textContent = tr(editor.hidden ? 'script.editTemplate' : 'script.hideTemplate');
        });
        $('resetTemplateBtn').addEventListener('click', () => {
            $('templateText').value = state.templateOriginal || '';
            toast(tr('script.templateResetDone'));
        });
        $('uploadTemplateBtn').addEventListener('click', () => $('templateFileInput').click());
        $('templateFileInput').addEventListener('change', (event) => {
            uploadTemplate(event.target.files && event.target.files[0]);
            event.target.value = '';
        });
        $('saveTemplateBtn').addEventListener('click', saveTemplate);

        $('providerSelect').addEventListener('change', (event) => {
            state.providerId = event.target.value;
            renderModels();
        });
        $('modelSelect').addEventListener('change', (event) => {
            state.model = event.target.value;
        });

        $('generateBtn').addEventListener('click', () => generate());
        $('stopBtn').addEventListener('click', () => {
            if (state.controller) state.controller.abort();
        });

        $('results').addEventListener('click', (event) => {
            const button = event.target.closest('button[data-action]');
            if (!button) return;
            const result = state.results[Number(button.dataset.episode)];
            if (!result) return;
            if (button.dataset.action === 'copy-unit') {
                const unit = (result.units || [])[Number(button.dataset.unit)];
                if (unit) copyText(unitText(unit), button);
            } else if (button.dataset.action === 'run-unit') {
                runSingleUnit(Number(button.dataset.unit));
            } else if (button.dataset.action === 'unit-version') {
                const unit = (result.units || [])[Number(button.dataset.unit)];
                if (unit) selectUnitVersion(unit, button.dataset.version);
            } else if (button.dataset.action === 'unit-compare') {
                const unit = (result.units || [])[Number(button.dataset.unit)];
                if (unit) toggleUnitCompare(unit);
            } else if (button.dataset.action === 'copy-episode') {
                copyText(episodeMarkdown(result), button);
            } else if (button.dataset.action === 'clear-episode') {
                // 把这一份分镜的提示词整批清空（不可恢复）
                clearUnitsOfEpisode(result);
            } else if (button.dataset.action === 'resume-tail') {
                // 剧本/人物设定改了也接着跑断点里剩下的分段
                generate(true);
            } else if (button.dataset.action === 'regen-episode') {
                // 按当前剧本 / 人物设定 / 画风把全部提示词重写一遍
                regenerateAllUnits(result);
            } else if (button.dataset.action === 'bridge-episode') {
                // 跑着的时候再点一下就是「停」
                if (state.bridgeRunning) {
                    if (state.bridgeAbort) state.bridgeAbort.abort();
                } else {
                    bridgeStoryboard();
                }
            } else if (button.dataset.action === 'unit-page') {
                goUnitsPage(result, button.dataset.page);
                renderResults();
            } else if (button.dataset.action === 'insert-chat') {
                // 把对话生成的新分镜插到这张卡片前面
                insertChatUnits(Number(button.dataset.unit));
            }
        });

        // 分镜提示词的可编辑输入框：敲字时只同步进内存，失焦时才落盘。
        // 判断「改没改」用 defaultValue（渲染进来的原文），比另记一个标记更稳：
        // 粘贴、输入法上屏这些路径也都算数。
        $('results').addEventListener('input', (event) => {
            const target = event.target.closest('[data-unit-text]');
            if (!target) return;
            const unit = editedUnitOf(target);
            if (unit) unit.prompt = target.value;
        });

        $('results').addEventListener('focusout', (event) => {
            const target = event.target.closest('[data-unit-text]');
            if (!target || target.value === target.defaultValue) return;
            const unit = editedUnitOf(target);
            if (!unit) return;
            unit.prompt = target.value;
            saveStoryboardState();
        });

        $('copyAllBtn').addEventListener('click', () => {
            const markdown = allMarkdown();
            if (!markdown) {
                toast(tr('script.needResult'));
                return;
            }
            copyText(markdown, null);
        });
        $('exportMdBtn').addEventListener('click', () => {
            const markdown = allMarkdown();
            if (!markdown) {
                toast(tr('script.needResult'));
                return;
            }
            download(`script-prompts-${stamp()}.md`, markdown, 'text/markdown;charset=utf-8');
        });
        $('exportJsonBtn').addEventListener('click', () => {
            const result = finishedResult();
            if (!result) {
                toast(tr('script.needResult'));
                return;
            }
            download(`script-prompts-${stamp()}.json`, JSON.stringify({
                template_id: state.templateId,
                provider: state.providerId,
                model: state.model,
                outline: result.outline,
                units: (result.units || []).map((unit) => ({
                    code: unit.code,
                    duration: unit.duration,
                    name: unit.name,
                    prompt: unitText(unit),
                })),
                raw: result.raw,
            }, null, 2), 'application/json;charset=utf-8');
        });
        $('saveLibraryBtn').addEventListener('click', saveToLibrary);
        const importInput = $('importStoryboardInput');
        $('importStoryboardBtn').addEventListener('click', () => importInput.click());
        $('loadLibraryUnitsBtn').addEventListener('click', loadUnitsFromLibrary);
        // 对话补分镜：面板开合、发送、停止；Enter 发送、Shift+Enter 换行
        $('chatStoryboardBtn').addEventListener('click', () => toggleChatPanel());
        $('chatSendBtn').addEventListener('click', sendChatMessage);
        $('chatStopBtn').addEventListener('click', () => {
            if (state.chatController) state.chatController.abort();
        });
        $('chatInput').addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            sendChatMessage();
        });
        $('chatClearBtn').addEventListener('click', () => {
            state.chatMessages = [];
            state.chatDraft = [];
            renderChatLog();
            // 「在此处插入」按钮跟着草稿一起收起来
            renderResults();
        });
        importInput.addEventListener('change', () => {
            importStoryboardFile(importInput.files && importInput.files[0]);
            importInput.value = '';
        });
        $('saveStoryboardBtn').addEventListener('click', saveStoryboardToLocal);
        $('openStoryboardBtn').addEventListener('click', toggleStoryboardLibrary);
        // 剧本切换条
        $('scriptProjectSelect').addEventListener('change', (event) => switchScriptProject(event.target.value));
        $('newScriptBtn').addEventListener('click', newScriptProject);
        $('renameScriptBtn').addEventListener('click', renameScriptProject);
        $('deleteScriptBtn').addEventListener('click', deleteScriptProject);
        // 主机那块是动态渲染的，用事件委托接「检测连接」
        $('unitsRunHosts').addEventListener('click', (event) => {
            if (event.target.closest('[data-host-check]')) refreshUnitHosts(true);
        });
        // 已保存的清单是动态渲染的，用事件委托接按钮
        $('storyboardLib').addEventListener('click', (event) => {
            const load = event.target.closest('[data-sb-load]');
            if (load) {
                loadStoryboardFromLocal(load.getAttribute('data-sb-load'));
                return;
            }
            const remove = event.target.closest('[data-sb-delete]');
            if (remove) deleteStoryboardFromLocal(remove.getAttribute('data-sb-delete'));
        });

        $('comfyWorkflowSelect').addEventListener('change', async (event) => {
            // 只有用户自己换过工作流才记住，否则默认值会被首次加载写死
            localStorage.setItem(COMFY_WORKFLOW_KEY, event.target.value);
            try {
                await selectComfyWorkflow(event.target.value);
            } catch (error) {
                toast(String(error.message || error));
            }
        });

        $('runAllUnitsBtn').addEventListener('click', runAllUnits);
        $('stopAllUnitsBtn').addEventListener('click', () => {
            // 只是不再派新的：正在跑的那条会跑完，中途结果照样留着
            state.comfyStop = true;
        });

        window.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'studio-lang' && window.StudioI18n) {
                window.StudioI18n.set(event.data.lang);
            }
        });
        window.addEventListener('studio-lang-change', () => {
            document.title = tr('script.title');
            renderTemplateOptions();
            if ($('toggleTemplateBtn')) {
                $('toggleTemplateBtn').textContent = tr($('templateEditor').hidden ? 'script.editTemplate' : 'script.hideTemplate');
            }
            updateScriptSummary();
            renderImageOptions();
            renderCastGallery();
            renderResults();
        });
    }

    async function init() {
        bindEvents();
        // 画风列表要最先拿到：恢复剧本时得知道这份剧本选的是哪种画风
        try {
            await loadCastStyles();
        } catch (error) {
            toast(tf('script.loadFailed', { detail: error.message || error }));
        }
        // 先恢复上次的剧本、人物与场景、参考图、分镜结果，刷新后不必重来
        restoreCastState();
        restoreStoryboardState();
        // 本机存着好几份剧本，把手上这份换回来（上面那两份只当读不到本机文件时的兜底）
        await restoreScriptProject();
        // 手上这份剧本的素材库；restoreScriptProject 走本地缓存分支时不会经过 loadScriptProject
        await ensureScriptAssetLibrary();
        updateScriptSummary();
        syncGenerateEnabled();
        syncCastGallery();
        // 素材库里已有的角色 / 场景参考图先按条目名认回来，卡片上的「关联素材」才有缩略图
        await matchCastLibraryImages();
        // 素材图是在同步逻辑上线之前出好的那批存量分镜，在这里补编号修正 + 待重跑标记
        backfillUnitRefSync();
        // PenShot 旧存档片段：先按任务号补上场景 / 人物标识，再据此绑定参考图
        await enrichPenshotFragmentRefs();
        backfillPenshotUnitRefs();
        renderResults();
        // 主机连通性：进页面先探一次，之后每 30 秒探一次（页面切走时跳过）
        refreshUnitHosts(false);
        startUnitHostTimer();
        // 素材库里已有的成片先按名字认领回分镜，再把本地跑出来还没入库的补进去
        await matchLibraryVideos();
        saveMissingUnitRuns();
        setStatus(summaryText());
        document.title = tr('script.title');
        try {
            await Promise.all([loadTemplates(), loadCastTemplates(), loadProviders(), loadShotSkills()]);
        } catch (error) {
            toast(tf('script.loadFailed', { detail: error.message || error }));
        }
        try {
            await Promise.all([loadComfyWorkflows(), loadCastComfyWorkflows()]);
        } catch (error) {
            toast(tf('script.loadFailed', { detail: error.message || error }));
        }
        // 模板/人物设定都恢复完之后再判一次断点：上次停在一半的话按钮显示「继续生成」
        setRunningUI(false);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
