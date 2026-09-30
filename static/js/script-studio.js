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
        castRunning: false,
        castController: null,
        // 人物、场景与道具参考图（右侧画廊）
        castItems: { character: [], scene: [], prop: [] },
        // 「人物清单 / 场景清单 / 道具清单」里声明的中英别名：{ 归一化主名: [别名…] }
        castAliases: {},
        castShots: {},
        // 画廊里人物 / 场景 / 道具三组各自的折叠状态
        castCollapsed: { character: false, scene: false, prop: false },
        imageProviders: [],
        imageProviderId: '',
        imageModel: '',
        imageEngine: 'comfy',
        imageRatio: '3:2',
        imageResolution: '1k',
        // ComfyUI 工作流生图
        castComfyWorkflows: [],
        castComfyWorkflow: '',
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

    function setCastRunningUI(running) {
        $('castGenerateBtn').hidden = running;
        $('castPropGenerateBtn').hidden = running;
        $('castStopBtn').hidden = !running;
    }

    function handleCastEvent(event) {
        if (event.type === 'cast_start') {
            $('castStatus').textContent = tr('script.castRunning');
        } else if (event.type === 'cast_done') {
            const parts = splitCastMarkdown(event.content || '');
            if (event.kind === 'prop') {
                // 这次只出道具：人物与场景的提示词、参考图都留着，只作废道具自己的那份图
                $('castProps').value = parts.prop || $('castProps').value;
                Object.keys(state.castShots).forEach((key) => {
                    if (key.startsWith('prop:')) delete state.castShots[key];
                });
            } else {
                setCastText(parts.character, parts.scene, parts.prop);
                // 人物、场景与道具换了，之前生成的参考图全部作废
                state.castShots = {};
            }
            $('castStatus').textContent = event.truncated ? tr('script.truncated') : tr('script.castDone');
            syncCastGallery();
            syncGenerateEnabled();
        } else if (event.type === 'cast_error') {
            $('castStatus').textContent = event.detail || tr('script.failed');
        }
    }

    // only='prop' 时只提取道具：人物与场景的提示词一个字都不动
    //（已经生成的参考图是靠提示词匹配的，重写人物/场景会把那些图全冲掉）
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
                    kind: only === 'prop' ? 'prop' : '',
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
        return { results, session: state.session };
    }

    function applyStoryboardState(results, session) {
        state.results = Array.isArray(results) ? results : [];
        // 老数据里的成片记录没有版本信息，先补齐，之后重新生成才能按版本留着旧的
        state.results.forEach((item) => ((item && item.units) || []).forEach(normalizeUnitRuns));
        state.session = session && Array.isArray(session.queue) ? session : null;
    }

    function saveStoryboardState() {
        try {
            localStorage.setItem(STORYBOARD_STORE_KEY, JSON.stringify(storyboardSnapshot()));
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
        return { engine: state.imageEngine, collapsed: state.castCollapsed, shots };
    }

    // 内容指纹：生成过程中进度百分比一直在动，但那些不用存盘。只算「该留的」——
    // 正文与人物场景道具的长度、分镜数、每个分镜跑没跑完、断点还剩几段。
    function workspaceSignature(workspace) {
        const units = workspace.results.reduce((all, item) => all.concat((item && item.units) || []), []);
        return [
            workspace.script.length,
            String(workspace.cast_characters || '').length,
            String(workspace.cast_scenes || '').length,
            String(workspace.cast_props || '').length,
            units.length,
            units.map((unit) => ((unit.run || {}).status || '-')).join(','),
            (workspace.session && workspace.session.queue ? workspace.session.queue.length : 0),
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
            results: snapshot.results,
            session: snapshot.session,
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
            results: [],
            session: null,
        };
    }

    function markLocalWorkspaceOwner() {
        try {
            if (scriptProjectId) localStorage.setItem(SCRIPT_PROJECT_OWNER_KEY, scriptProjectId);
        } catch (error) { /* 隐私模式或超配额时静默跳过 */ }
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
            applyStoryboardState(data.results, data.session);
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

    async function flushScriptProject(options) {
        if (scriptProjectBusy || !scriptProjectId) return;
        const force = !!(options && options.force);
        const workspace = currentWorkspace();
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
        if (owner === target.id && localEditAt > storedUpdatedAt) {
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

    // 在线生图和 ComfyUI 工作流的平台配置不同；比例与分辨率两种引擎都要，始终显示
    function renderCastImageEngine() {
        const comfy = state.imageEngine === 'comfy';
        ['imageProviderSelect', 'imageModelSelect'].forEach((id) => {
            $(id).hidden = comfy;
        });
        $('castComfyWorkflowSelect').hidden = !comfy;
    }

    // 工作流能不能配画幅要等拿到它的 JSON 才知道，null 表示还没探到，此时不做任何提示
    async function refreshCastSizeSupport() {
        state.castComfySizeReady = null;
        if (!state.castComfyWorkflow) {
            updateCastImageStatus();
            return;
        }
        try {
            state.castComfySizeReady = castComfySupportsSize(await castComfyWorkflowData());
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
        const select = $('castComfyWorkflowSelect');
        select.innerHTML = '';
        state.castComfyWorkflows.forEach((item) => {
            const option = document.createElement('option');
            option.value = item.name;
            option.textContent = item.title || item.name;
            select.appendChild(option);
        });
        const remembered = localStorage.getItem('studio_script_cast_comfy_workflow') || '';
        const names = state.castComfyWorkflows.map((item) => item.name);
        const target = names.includes(remembered) ? remembered
            : (names.includes(DEFAULT_CAST_COMFY_WORKFLOW) ? DEFAULT_CAST_COMFY_WORKFLOW : (names[0] || ''));
        state.castComfyWorkflow = target;
        if (target) select.value = target;
        select.disabled = !target;
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
        const name = String(text || '').replace(/[（(][^）)]*[）)]\s*$/, '').trim();
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
    function castNameKeys(title) {
        const keys = new Set();
        const add = (raw, declared) => {
            const key = normalizeRefName(raw);
            if (!key) return;
            const cjk = (key.match(/[\u4e00-\u9fa5]/g) || []).length;
            if (cjk ? key.length >= 2 : key.length >= (declared ? 3 : 4)) keys.add(key);
        };
        add(title);
        String(title || '').split(/[·•|｜/／、（）()【】\[\]「」『』]+/).forEach((part) => add(part));
        // 清单里给的中英别名：分镜提示词里写英文时，靠它才认得出这个条目
        (state.castAliases[normalizeRefName(title)] || []).forEach((alias) => add(alias, true));
        return [...keys];
    }

    // 这个分镜里提到的人物 / 场景：拿上面人物与场景的条目名在单元文字里做包含匹配，
    // 命中即视为「用了这份素材」，卡片上把对应的本地图片带出来。
    function castRefsOfUnit(unit) {
        const text = normalizeRefName([unitText(unit), unit.name, unit.raw].filter(Boolean).join(' '));
        if (!text) return [];
        return allCastEntries().filter(({ item }) => castNameKeys(item.title).some((key) => text.includes(key)));
    }

    function castRunLabel(item, index) {
        const shot = castShotOf(item, index);
        if (!shot) return tr('script.imageGenOne');
        if (shot.status === 'running') return tr('script.imageRunning');
        if (shot.status === 'failed') return tr('script.imageRetry');
        return tr('script.imageRegen');
    }

    function castShotHtml(item, index) {
        const shot = castShotOf(item, index);
        if (!shot) return `<div class="placeholder">${esc(tr('script.imageIdle'))}</div>`;
        if (shot.status === 'running') return `<div class="placeholder">${esc(tr('script.imageRunning'))}</div>`;
        if (shot.status === 'failed') return `<div class="placeholder failed">${esc(tr('script.failed'))}：${esc(shot.error)}</div>`;
        return `<a href="${esc(shot.url)}" target="_blank" rel="noopener"><img src="${esc(shot.url)}" alt="" loading="lazy"></a>`;
    }

    function castItemHtml(item, index) {
        const key = castShotKey(item, index);
        const shot = castShotOf(item, index);
        const running = Boolean(shot && shot.status === 'running');
        return `
            <div class="cast-item">
                <div class="cast-item-head">
                    <span class="title" title="${esc(item.title)}">${esc(item.title)}</span>
                    <button class="btn" data-cast-run="${esc(key)}"${running ? ' disabled' : ''}>${esc(castRunLabel(item, index))}</button>
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

    async function castComfyWorkflowData() {
        const name = state.castComfyWorkflow;
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

    async function runCastComfyShot(item) {
        const data = await castComfyWorkflowData();
        if (!data) throw new Error(tr('script.imageNoWorkflow'));
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
        // 画幅最后写，覆盖掉工作流里自带的宽高默认值
        applyCastSizeToComfy(params, data, castImageSize());

        const created = await fetch('/api/canvas-comfy-tasks', {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify({
                prompt: item.prompt,
                workflow_json: state.castComfyWorkflow,
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

    async function submitCastShot(item, index) {
        const key = castShotKey(item, index);
        state.castShots[key] = { status: 'running', prompt: item.prompt, url: '', error: '' };
        refreshCastItem(item, index);
        const url = state.imageEngine === 'comfy'
            ? await runCastComfyShot(item)
            : await runCastOnlineShot(item);
        state.castShots[key] = { status: 'done', prompt: item.prompt, url, error: '' };
        refreshCastItem(item, index);
        saveCastState();
        saveCastShotToLibrary(item, index);
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
            if (!state.castComfyWorkflow) {
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

    function castImageReady() {
        return state.imageEngine === 'comfy'
            ? Boolean(state.castComfyWorkflow)
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

    // forceTail：结果卡片上的「继续生成后面分镜」。剧本/人物设定跟断点对不上时也照样接着跑，
    // 用的是断点里还剩下的分段（属于改动前那份剧本），只是用当前的模板/设定继续写。
    async function generate(forceTail) {
        if (state.running) return;
        if (!scriptContent()) {
            toast(tr('script.needText'));
            return;
        }
        if (!$('templateText').value.trim()) {
            toast(tr('script.needTemplate'));
            return;
        }

        const resuming = forceTail ? Boolean(pendingSession()) : Boolean(resumableSession());
        // 重新生成提示词：先把已经出片的分镜按编号留一份，新分镜一出来就贴回自己的槽位
        const keptRuns = resuming ? null : collectUnitRuns();
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
            if (error.name !== 'AbortError') {
                const message = String(error.message || error);
                toast(message);
                state.results.forEach((item) => {
                    if (item.status === 'pending' || item.status === 'running') {
                        item.status = 'error';
                        item.error = message;
                    }
                });
            } else if (session.queue.length) {
                // 用户主动停止：已完成的分段留着，剩下的等「继续生成」
                result.status = 'paused';
            } else {
                session.done = true;
                state.session = null;
                result.status = 'done';
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
            else card.querySelector('pre').insertAdjacentElement('beforebegin', next);
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
                    const hint = resumableSession() ? 'script.errorKept'
                        : (pendingSession() ? 'script.resumeUnavailable' : 'script.breakpointLost');
                    body += `<div class="warn-text">${esc(tr(hint))}</div>`;
                }
            } else if (result.status === 'paused') {
                const hint = resumableSession() ? 'script.pausedHint'
                    : (pendingSession() ? 'script.resumeUnavailable' : 'script.breakpointLost');
                body += `<div class="warn-text">${esc(tr(hint))}</div>`;
            }
            if (streaming) {
                // 生成中：把当前分段的流式输出实时贴出来；增量刷新只改这块 DOM，
                // 不走整卡重绘（否则每个 token 都会连累一次 localStorage 写入）。
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
                    // 单元排成网格，和上面人物卡片一样一行放好几个，别把右栏拉成一长条；
                    // 一页最多 20 个，data-unit 用整份里的全局序号，勾选和单跑都不受影响
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
                            ${unitRefsHtml(unit)}
                            <pre>${esc(unitText(unit))}</pre>
                            <div class="unit-run-slot" data-unit-run="${unitIndex}">${unitRunHtml(unit, unitIndex, result.index)}</div>
                        </div>
                    `;
                    }).join('');
                    body += `<div class="unit-grid">${html}</div>${unitsPagerHtml(result)}`;
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
                            <button class="btn" data-action="copy-episode" data-episode="${result.index}">${esc(tr('script.copyEpisode'))}</button>
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

    // 分镜里关联到的角色 / 场景图，出图后就是现成的参考图：
    // 人物定造型、场景定环境，带进工作流里，生成出来的画面才和人物设定是一个样子。
    function unitCastRefUrls(unit) {
        return castRefsOfUnit(unit).map(({ item, index }) => {
            const shot = castShotOf(item, index);
            return shot && shot.status === 'done' && shot.url ? shot.url : '';
        }).filter(Boolean);
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

    // 还没成功跑出片、也不在池子里的分镜，才算「要补的」
    function unitRunPending(unit, index) {
        return (!unit.run || unit.run.status !== 'succeeded') && !unitRunPoolHas(index);
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

    async function matchCastLibraryImages() {
        const entries = allCastEntries();
        if (!entries.length || !scriptAssetLibraryId) return 0;
        const groups = [];
        try {
            const response = await fetch('/api/asset-library', { cache: 'no-store' });
            if (!response.ok) return 0;
            const data = await response.json();
            const library = ((data.library || {}).libraries || []).find((row) => row.id === scriptAssetLibraryId);
            if (!library) return 0;
            (library.categories || []).forEach((cat) => {
                const kind = /道具|prop/i.test(String(cat.name || ''))
                    ? 'prop'
                    : (/场景|scene/i.test(String(cat.name || '')) ? 'scene' : 'character');
                ((cat.items) || []).forEach((item) => { groups.push({ kind, item }); });
            });
        } catch (error) {
            // 素材库读不到就当没有，不影响正常生成
            return 0;
        }
        let matched = 0;
        entries.forEach(({ item, index }) => {
            // 已经有对得上的图了就不动它
            if (castShotOf(item, index)) return;
            const wanted = castLibraryKey(item.title);
            if (!wanted) return;
            const picked = groups
                .filter((row) => row.kind === item.kind && castLibraryKey(row.item.name) === wanted)
                .sort((a, b) => (b.item.created_at || 0) - (a.item.created_at || 0))[0];
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
        const extra = `${player}${versions}${unitCompareHtml(unit)}`;
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
        $('castGenerateBtn').addEventListener('click', () => generateCast());
        // 只补道具：不会碰人物与场景，已经出好的参考图照旧
        $('castPropGenerateBtn').addEventListener('click', () => generateCast('prop'));
        $('castStopBtn').addEventListener('click', () => {
            if (state.castController) state.castController.abort();
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
        ['castCharacters', 'castScenes'].forEach((id) => {
            $(id).addEventListener('input', () => {
                syncGenerateEnabled();
                clearTimeout(castSyncTimer);
                castSyncTimer = setTimeout(syncCastGallery, 300);
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
        $('castComfyWorkflowSelect').addEventListener('change', (event) => {
            state.castComfyWorkflow = event.target.value;
            localStorage.setItem('studio_script_cast_comfy_workflow', state.castComfyWorkflow);
            refreshCastSizeSupport();
            updateCastImageStatus();
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
            } else if (button.dataset.action === 'resume-tail') {
                // 剧本/人物设定改了也接着跑断点里剩下的分段
                generate(true);
            } else if (button.dataset.action === 'unit-page') {
                goUnitsPage(result, button.dataset.page);
                renderResults();
            } else if (button.dataset.action === 'insert-chat') {
                // 把对话生成的新分镜插到这张卡片前面
                insertChatUnits(Number(button.dataset.unit));
            }
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
            await Promise.all([loadTemplates(), loadCastTemplates(), loadProviders()]);
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
