# 人物与场景提取 · 完整提示词模板（文字 → 三视图 / 场景图）

本模板同时适用于：

- **剧本流**：从小说、剧本、分镜表里提取人物与场景，产出参考图提示词；
- **设定流**：从人物档案、世界观文档补全缺失的视觉维度。

两种工作流只在"素材从哪来"这一点不同，最终输出格式完全一致。

> 与 `MiniMax文戏完整提示词模板.md` 平级，但**处理的对象根本不同**，先看下面这张分岔表——搞反了整套图就废。

## 一、先分清：三视图是工具图，场景图是叙事图

| 维度 | **人物三视图（工具图）** | **场景图（叙事图）** |
|---|---|---|
| 唯一目的 | 让人看清"这个人从头到脚长什么样"，并被后续所有图当锚点复用 | 交代空间、尺度、材质与光 |
| 光 | **平、匀、中性**；正面主光 + 两侧补光 | **单一来源、强方向、可有戏剧性** |
| 背景 | **纯中性无缝底**（纯白或中灰） | 环境即叙事 |
| 姿态 | **中立项立**，双臂自然下垂，双脚与肩同宽，头正，**无表情** | 有戏、有动势 |
| 人 | 主体就是人，必须清晰 | **必须不可辨识**（仅作比例参照） |
| 失败长什么样 | 三个视图长成三个人 / 有两个面看不清 | 游戏关卡感 / 发光符文 / 过饱和 |

**最大的错**：用电影光出三视图（会有两面看不清），用平光出场景图（什么信息都没有）。

---

## 二、填写规则

1. 把所有 `[方括号占位内容]` 替换为实际内容。
2. **只写能被画出来的东西。** 心理、因果、时间跨度画不出来，必须翻译成物理事实。
   - ✗ `他心里很冷` → ✓ `no expression at all, hands perfectly still`
   - ✗ `她苦了很多年` → ✓ `hollow cheeks, skin stretched over bone, faded patched jacket`
3. **一段一个维度，用逗号并列。** 不要写成长句，模型对短语串更敏感。一段 2–4 个短语，堆到十几个会互相稀释。
4. **前后权重递减。** 前两段是模型的锚；环境和镜头放后面。
5. **三件事不许省**：磨损细节、光源方向、主色调。没有磨损的图会像游戏皮肤，不像故事里的人。
6. 人名、地名**一律拼音或英文意译**，不要把中文方块字塞进提示词——模型会把它当成"要求画面里出现文字"。
7. **尺寸不写进提示词**，用工具的 `size` 参数控制（见第十节）。
8. **画面里零个规格文字**：色值、字段名、参考线、标注一律不许出现。
9. **固定尾缀逐字复制**，跨图一字不改——这是成套图风格统一的关键。
10. **不要写"美、好看、帅、有压迫感"**，换成可画的物理事实（眉型、伤位、袖口磨白、光的来向）。
11. **"无表情"也是表情，必须写**。不写的话模型默认给一张笑脸。
12. **数量词要前置强调**。"两盏油灯是仅有的两点光"经常出成四五处灯；写成 `exactly two small oil lamps, the only two points of light in the entire frame`。

---

## 三、生成前引导流程

这部分先完成判断和采集，再进入后面的成品模板。**不要拿到文本后直接填提示词。**

### 1. 先找素材真源，别急着通读全书

| 优先级 | 文件 | 价值 |
|---|---|---|
| 1 | `*参考图描述*` / `*人物与场景参考图描述*.md` | 已经提取好的视觉素材，直接用 |
| 2 | `*设定*` / `*世界观*` / `*人物档案*` | 年龄、身份、体态、性格的原设定 |
| 3 | **`*提示词*` 里已写完的 prompt** | 风格锚串与画幅口径从这儿抄，不要另起一套 |
| 4 | 分章正文（`chapters/` 或 `第X章*`） | 逐章补采集：服装、道具、伤、场景 |
| 5 | **镜头脚本 / 分镜表** | **最高密度的视觉信息源**（见第五节字段映射） |
| 6 | 合稿 / 阅读版 HTML | 全文检索用 |

> **有素材真源时不必逐字重读全书**：把章节当检索对象，只补素材文档里缺的维度。先读设定文档建立清单 → 用 Glob 列章节 → 定稿后按清单精准检索。

### 2. 信息分流（五类，第三类和第四类最难）

| 类别 | 原文形态 | 处理口径 |
|---|---|---|
| **可画的外貌** | `眉很平、很直` | 直接进 ①②③ 段 |
| **心理与因果** | `他很愤怒` / `因为…所以…` | 翻译成动作或并置：`jaw set, hands clenched at the sides` |
| **时间跨度** | `三年后` / `过了很久` | 转成**磨损**：`worn smooth and shiny at the corners`、`frost coating the exposed steel` |
| **超自然设定** | `吞噬之道` / `星力` | 转成**图形语法**（可重复出现的图形），全书统一 —— 这是最有价值的一步 |
| **画不出来的** | 运镜 / 声音 / 时长 | **丢弃**。声音可反推视觉（见第五节） |

### 3. 人物采集清单（8 项 + 关键姿态）

对每个角色填这 8 项。**填不出的项标注"未提及"，不要编。**

| 项 | 采集什么 | 反例 → 正例 |
|---|---|---|
| 1 体态 | 身高、胖瘦、肩背、站姿 | `很瘦` → `gaunt, hollow-cheeked, skin stretched over bone` |
| 2 脸 | 脸型、颧骨、下颌、肤色 | `脸很平` → `a flat featureless face lacking relief` |
| 3 发 | 长度、颜色、束法、打理程度 | `白发` → `sparse straggly white hair, uncombed` |
| 4 眼 | 眼形、瞳色、眼神、异状 | `枯井` → `two deep sunken eyeless sockets, absolute black, no reflection` |
| 5 皮肤与手 | 粗糙度、茧、晒色、疤 | `矿工的手` → `dust-grey hands, calluses on palm and knuckles, mine dust in the creases` |
| 6 伤与残 | 部位、方向、新旧 | `左臂断了` → `left arm broken at shoulder and elbow, hanging in a cloth sling` |
| 7 服装 | 材质、颜色、磨损、**阶层信号** | `旧衣服` → `faded coarse indigo padded jacket with elbow patches and medicine stains at the hem` |
| 8 道具 | 1 件标志物 + **它自己的经历** | `一把刀` → `a short knife a foot three long, three nicks in the blade, the grip hollowed into the shape of a hand` |

**另记一条「关键姿态」**：原文里最像剧照的那一个动作。它是这个人物的海报。

**阶层对照法（快速拉开辨识度）**：把同书角色按权力分两列，材质词立刻分开。

| 被剥削者 | 掌权者 |
|---|---|
| `coarse hemp`、`patched`、`bare feet`、`worn through with toes showing` | `silk`、`embroidered`、`jade`、`groomed, immaculately clean` |
| 手：`calloused, dust-grey` | 手：`smooth, unmarked, resting flat on the knees` |

> **一个"手"的细节，比一整段外貌描写更能说明这个人是谁。**

### 4. 场景采集清单（6 项）

| 项 | 采集什么 | 例 |
|---|---|---|
| 1 空间结构 | 形状、层次、边界 | `rows of extremely tall dark wooden pillars supporting heavy beams` |
| 2 **尺度** | **给数字或对比物** | `ninety feet deep`、`wide enough for four carts abreast` |
| 3 主色调 | 两个色为主，别超过三个 | `bleached white dominant, the only red in frame is one streak of blood` |
| 4 光源 | 从哪来 + 几个 | `only two small oil lamps for the whole pit` |
| 5 关键物件 | 2–3 个，多了会互相抢 | `a bronze brazier`、`an unrolled yellowed silk map` |
| 6 氛围 | 一句**可画的判断** | `every living person below either kneeling or pressed flat` |

**尺度一定要给数字或参照物**：`很深的坑` 画不出来；`one hundred feet across and ninety feet deep, figures the size of ants` 画得出来。参照物是尺度的翻译器。

### 5. 分镜表 → 静态图的字段映射（八个字段有三个画不出来）

| 分镜字段 | 能否进图 | 处理 |
|---|---|---|
| 景别 | ✓ | `大远景 ELS` → `extreme wide shot` |
| 机位 / 角度 | ✓ | `高机位，俯角 25°` → `high angle, about twenty-five degrees down` |
| 画面内容 | ✓ **核心** | 逐项转成短语，按六段式重新排序 |
| 光色 | ✓ | 它本来就是"主色调 + 光源"的合体，直接当⑤段用 |
| **运镜** | ✗ **丢失** | 静图没有运动。只在要暗示速度时用运动模糊，一般直接删 |
| **声音** | ✗ **丢失** | 但**可反推视觉**——见下表 |
| **时长** | ✗ **丢失** | 与单张图无关；只影响**出图张数** |
| 导演阐述 | ◐ 部分可用 | 其中的「视觉母题 / 色调走向 / 情绪曲线」提炼出来就是风格锚串 |

**声音转视觉（声音字段的正确用法）**：别丢掉整条声音字段，先反问"这个声音意味着画面里有什么"。

| 分镜里的声音 | 反推出的视觉 |
|---|---|
| 风呼啸而出 | 扬起的尘、风沙颗粒在光柱里、衣角被吹起 |
| 铁锈味的低频噪声 | 雾/尘的压迫感、低垂的烟层、画面失去通透度 |
| 万人的呼吸汇成嗡鸣 | 密到看不见地面的跪伏人群、极远景的纹理感 |
| 骨头碎裂的脆响 | 皮下渗血、错位的肢体、绷紧到发白的皮肤 |
| **绝对静默** | 抽掉一切动态元素——没有风、没有尘、没有烟，画面"凝住" |

### 6. 出图节奏：锚点先行

```
先出「主角标准像」1 张（必要时 + 主场景概念图 1 张）
        ↓ 用户确认画风与长相
        ↓ 未确认之前绝不往下铺
以锚点图为 image1 派生其余图（input_fidelity 调高）
        ↓
每批不超过 5 张，逐张读回来核对，再继续
```

**锚点图必须让面部完整露出。** 头发、面纱、侧脸、低头——任何遮住五官的安排都会毁掉锚点的复用价值。遮眼、遮脸的效果留到名场面那几张再要。

**模型会把人画老**：写 `16-year-old` 常得到二十出头的结果。补上 `adolescent, unlined smooth face, slender immature build` 对抗。

---

## 四、人物三视图模板

三个版式，按需要选一个。**同一批人物必须用同一个版式。**

### 版式 A · 拼贴三视图（左特写 + 右正/侧/背三格）

适合：需要同时看清"脸"和"整套穿搭"；底色可选纯白（设定稿感）或中灰（电影定妆感）。
画幅：`3:2 横`（`1536x1024`）。

**中文骨架（给国产模型 / MiniMax / 即梦类）**

```text
这是一组以[纯白/中性中灰]背景为底的[风格归属，如：真人写实角色设定稿]拼贴图，左侧为一张人像特写，
右侧分为三个穿搭视角。左侧展示一位[年龄段+性别+族裔/时代]，[肤色与脸型]，[眼与瞳色]，[发型发色+束法+打理程度]；
[上装/外层]，[内搭]，[眼神与表情，可写"目光平静地望向镜头"]。
中间和右侧面板从正面、侧面和背面三个角度展示同一套穿搭。整体搭配包括[外层]、[内搭]、[下装]和[鞋]，
并搭配[配饰或道具]。背面视角可见[背面要点]。整体风格[风格形容词，如：极简、单色调、中性化]，
是典型的[风格归属，如：韩系街头穿搭/中式古装战损风]。
三个视角必须是同一个人、同一姿势、同一比例、同一光。[人物身份免责句]。
```

**英文骨架（给 Midjourney / SD / Flux / Nano Banana 类）**

```text
A character reference collage on a [pure white / plain neutral seamless mid-grey] backdrop:
a close-up portrait on the left, three outfit panels on the right.
Left panel — close-up of [AGE + GENDER + ETHNICITY / ERA], [skin and face shape],
[eyes and iris colour], [hair length, colour, styling]; wearing [outer layer], [inner layer],
[gaze and expression].
Centre and right panels show the same outfit from the front, [left] profile and back.
The full look: [outer layer], [inner layer], [trousers / skirt], [shoes], plus [accessory or prop].
The back view shows [BACK-VIEW DETAIL]. [Style adjectives] overall.
The same person in all three views — identical pose, consistent scale, identical even lighting on all three.
Full body head-to-toe visible, generous margin around the figure.
[QUALITY TAIL] [RATIO]
```

**负面词**

```text
negative: different faces between views, inconsistent character, three different people,
changing proportions between views, dramatic shadow, chiaroscuro, low-key lighting,
missing back view, cropped feet, watermark, text, logo
```

---

### 版式 B · 并排三视图（中灰无缝底 · 正/侧/背并排）

适合：只要工具图，不需要单独一张脸的放大（例如后续要靠图生图派生剧照）。
画幅：`3:2 横`（`1536x1024`）。**方形会挤成一团，三个立姿并排必须横向空间。**

```text
Full character turnaround sheet on a plain neutral seamless mid-grey backdrop, three full-body views
of the same person standing side by side in a row: front view on the left, left profile view in the
centre, back view on the right. Identical pose in all three views — arms relaxed at the sides,
feet shoulder-width apart, head level, neutral expression, mouth closed. Consistent scale across views,
eye-level camera, identical even lighting on all three. Full body head-to-toe visible in every view,
generous margin around the figure.
[主体段 12 项，见下方]
[QUALITY TAIL] [RATIO]
```

**骨架里这四条是硬钉，改写时别漏**：

```
the same person in all three views
identical pose
consistent scale across views
identical even lighting on all three
```

---

### 版式 C · 一图一面（退路）

当模型始终无法在一张里放下三个一致的人时，改为逐面出图。竖幅 + 传锚点，是保证"同一张脸"最稳的路子，代价是出图量变三倍。

```text
第 1 张：
Full body front view of [主体段] on a plain neutral seamless mid-grey backdrop, eye-level camera,
even flat light, photorealistic live-action costume test, 4K detail, 2:3

第 2 张（image1 = 第 1 张）：
same person, now rotated 90 degrees to a left profile view, identical pose,
identical lighting and background, full body

第 3 张（image1 = 第 1 张）：
same person, now a back view, identical pose, identical lighting and background, full body
```

---

### 主体段：三视图专用写法（12 项落到一句里）

三视图比剧照更需要**穷尽式**描述——剧照靠环境与情绪传达信息，三视图只有人本身。

```
年龄性别 → 体态身高 → 脸型 → 眉 → 眼与视线 → 皮肤与手 → 发（含束法） →
【正面看不到的特征】 → 服装（材质+颜色+磨损，分上下身+鞋） → 标志性道具
```

**加粗那一项是关键**：每个角色至少要有一条"背面或侧面才看得到"的特征，写进主体段。这样三视图才有存在的意义——否则它只是一张平光照片。

| 例 | 背面要点 |
|---|---|
| 矿场苦役的少年 | 右肩的绳勒伤、背上的旧疤脊 |
| 独臂老兵 | 扎起来的那只空袖管、塌陷的左肩 |
| 身上有贯穿伤的人 | 那道斜贯背部的深疤 |
| 过分挺直的人 | 从背面看"挺得不像自然站姿"的脊线 |
| 驼背的老人 | 弓起的上背 |
| 白发老人 | 变薄的后脑 |

**通用约束三条**：

1. **年龄不许被画老** — 少年角色一律补 `adolescent, smooth unlined cheeks`。
2. **阶层靠手与磨损区分** — 底层写 `calloused, dust-grey hands` + `frayed hem`；权力者写 `smooth well-kept hands` + `every surface clean, pressed and unworn`。**权力者的 `unworn` 也要显式写。**
3. **颜色归属提前定** — 哪个颜色只属于谁、哪个体系，写进项目文档，三视图批里逐张对一遍。

---

## 五、场景图模板

**场景图分三类，参数与写法都不同。先分类再写提示词。**

| 类 | 目的 | 光 | 人 | 画幅 |
|---|---|---|---|---|
| **概念图** establishing | 交代空间与尺度 | 自然光 / 现场光源，可有戏剧性 | 极小、**不可辨识**，仅作比例参照 | 3:2 横 |
| **气氛图** | 交代材质与光的质感 | 单一来源，强方向 | 无，或局部肢体 | 3:2 横 |
| **名场面图** | 定格关键事件 | 按分镜光色 | **需要可辨识的角色** | 3:2 横 |

### 模板 1 · 概念图（交代空间与尺度）

往**大远景 + 鸟瞰 / 极端仰角**走，人只是画框里的一个点。

```text
[空间全貌 + 尺度数字]，[地面与材质及其损伤]，[光源方向与色温]，[一个极小的人形作为比例参照]，
[主色调两色]，extreme wide shot，[bird's-eye view / extreme low angle]，monumental composition，
35mm anamorphic，desaturated，cinematic film still，3:2
```

**中文骨架**

```text
[空间全貌与尺度]，[地面与材质，含损伤]，[光源来自何处、几个、什么色]，[极小的人形作比例参照]，
[主色调两色]，大远景，[鸟瞰/极端仰角]，宏阔构图，35mm 变形镜头，低饱和，电影剧照感，3:2
```

**示例（矿坑）**

```text
a vast open-pit mine shaft one hundred feet across and ninety feet deep carved with spiralling
wooden walkways, only two small oil lamps lighting the whole pit, suspended mine dust turning the
lamplight into dim orange pools, rust-brown rock and cold grey-green shadow, figures the size of
ants carrying woven baskets, extreme wide shot, bird's-eye view, 35mm anamorphic, desaturated,
cinematic film still, 3:2
```

### 模板 2 · 气氛图（交代材质与光）

往**中景 / 近景**走，给一个具体物件或一角空间。

```text
[一个具体物件或一角空间]，[磨损与材质特写]，[单一光源及其方向]，[余下部分沉入黑]，
medium shot，[机位]，shallow depth of field，macro detail，cinematic film still，3:2
```

**示例（花圃）**

```text
a small patch of freshly turned soil against a high grey brick wall in an old courtyard, a few
crooked flower seedlings planted unevenly, a chipped clay ladle lying nearby, low warm
late-afternoon sunlight raking across the wall, the only warm light in a cold desaturated film,
medium shot, ground-level camera, cinematic film still, 3:2
```

### 模板 3 · 名场面图（定格关键事件）

需要可辨识的角色，故**必须与人物锚点图共用同一主体段**，其余按分镜的光色与画面内容写。

```text
[主体段，与锚点图逐字一致]，[动作与姿态]，[环境全貌与尺度]，[按分镜光色写的单光源]，[主色调]，
[景别]，[机位角度]，[焦段]，[构图判断，如 absurd scale contrast, the figure tiny in frame]，[QUALITY TAIL]，3:2
```

### 反「游戏关卡感」（场景图最顽固的失败）

模型出场景时爱自作主张：发光符文、魔法光效、过饱和色调、夸张地形透视。负面词里必须钉死：

```text
negative: video game environment, MMORPG, glowing runes, magic light effects, oversaturated
colours, fantasy poster art, lens flare, HDR, matte painting, concept art
```

配套三条写法约束：

1. **概念图里的人必须不可辨识** — `tiny unidentifiable figures for scale`、`none of the faces distinguishable`。场景图一旦有张能看清的脸，视线就跑了。
2. **只写场景里真实存在的光源** — `natural practical lighting only from the sources present in the scene, no added light sources`。
3. **每一处表面都要有材质损伤** — `pitted stone, flaking plaster, oxidised iron, splintering wood, dust-caked`。

---

## 五之二、道具图模板（物品档案图）

道具图是**物品档案图**：它要当"这东西长什么样"的凭据，所以不叙事、不摆拍、不带人物，只把这个物件本身说清楚。后面分镜里出现同一件东西时，观众认的就是这张图。

### 三条硬约束

1. **画面里不能有任何人** — 没有手、没有指头、没有身体局部、没有半透明人影，也不要用假人模特撑衣服。
   `no hands, no fingers, no people, no faces, no body parts, no mannequin, no silhouette of a person`
2. **尺寸靠文字交代，不靠参照物** — 要说明大小时，写进描述（如 `roughly the size of a coin`），**不要**真的把硬币、手掌、尺子画进画面。
3. **同一道具在所有图里逐字一致** — 材质、颜色、磨损位置、刻字内容、破损缺口，一处都不能随图改。

### 模板 1 · 道具档案图（默认）

一张图说清形状、材质、磨损，平视偏俯视最容易看清整体。

```text
[道具名与类别]，[整体形状与比例]，[材质与表面处理]，[磨损、缺口、污渍的具体位置]，[颜色与主色调]，
[刻字或标识内容，没有就写 plain and unmarked]，isolated on a flat neutral seamless background,
even diffused studio light from the front with soft fill, no cast shadow on the background,
no hands, no people, no text overlay, [QUALITY TAIL]，1:1
```

### 模板 2 · 多角度档案图（关键道具用）

同一件道具在一张图里并排三个角度，前后左右的关系一次看全。

```text
three views of the same object in one frame: front view, side view and top view, arranged in a
horizontal row with equal spacing, identical scale in all three views, identical material and wear,
isolated on a flat neutral seamless background, even diffused studio light, no cast shadow,
no hands, no people, no text overlay, [QUALITY TAIL]，3:2
```

### 模板 3 · 状态变体（剧情里会变的关键道具）

同一件道具在不同单元里状态不同时（完好 / 破损 / 沾血 / 烧焦），**外形描述逐字复制**，只改状态那一段，并在标题里写明是哪一态。

```text
[主体段，与档案图逐字一致]，[本状态新增的变化，如 a clean diagonal crack across the lid, soot on the rim]，
isolated on a flat neutral seamless background, even diffused studio light, no cast shadow,
no hands, no people, no text overlay, [QUALITY TAIL]，1:1
```

### 道具负面词

```text
hands, fingers, people, faces, body parts, mannequin, floating object, plastic 3D render, CGI look,
oversaturated colours, lens flare, watermark, signature, text overlay, price tag, cluttered background,
retail product photography glare, reflections of a room
```

配套两条写法约束：

1. **材质要具体到加工痕迹** — `hand-forged iron`、`sand-cast brass with a visible seam`、`machine-turned aluminium`，比单写 `metal` 强得多。
2. **磨损要写死在哪** — 不是 `worn`，而是 `worn bright along the bottom edge where it is handled, a deep scratch across the left face`。同一件道具在后续所有单元里沿用同一处磨损描述。

---

## 六、固定尾缀（跨图逐字复制）

### 人物三视图 · 真人写实版

```text
Photorealistic live-action costume test photograph, real human being, shot on ARRI Alexa with a
50mm lens at eye level, soft even studio key light from the front with subtle fill from both sides,
flat neutral background, natural unretouched skin with visible pores, fine lines, uneven tone and
blemishes, matte skin with no highlights, natural colour grading, plain documentary wardrobe-test
lighting, no stylisation, 4K detail, 3:2
```

**「真人」的三根支柱，缺一根就会滑向插画**：

1. **皮肤必须写实** — `visible pores, fine lines, uneven tone, blemishes, matte skin, no highlights`
2. **镜头必须具体** — `shot on ARRI Alexa, 50mm lens at eye level`（等价可用 `85mm portrait lens`）
3. **明确否定风格化** — `no stylisation` + 负面词里压掉插画/3D/动漫

### 人物三视图 · 插画 / 概念稿版

用户要"设定图"而非真人时替换用：

```text
Digital character design sheet, clean flat rendering, cel-free soft shading, neutral mid-grey
backdrop, even lighting, high detail, 3:2
```

### 场景图 · 电影感版（默认）

```text
cinematic film still, hard-edged realistic rendering, desaturated muted palette, 35mm anamorphic,
volumetric dust, low-key lighting
```

### 场景图 · 真人实景版（实拍堪景照质感）

```text
【概念图骨架】
Photorealistic live-action location establishing shot of a real physical set, no people in frame
except tiny unidentifiable figures where noted for scale, shot on ARRI Alexa with a 24mm wide lens
from a high camera position, deep focus, natural practical lighting only from the sources present
in the scene, no added light sources, real film grain, 4K detail, 3:2

【气氛图骨架】
Photorealistic live-action detail shot of a real physical set, no people in frame, shot on ARRI
Alexa with a 35mm lens close to the surface, shallow depth of field, single practical light source
only, deep shadow filling the rest of the frame, real film grain, 4K detail, 3:2
```

真人实景的三支柱与人物三视图同一套，只是镜头不同：**材质写实**（`pitted stone, flaking plaster, oxidised iron, splintering wood, dust-caked`）+ **具体机型镜头** + **`no stylisation`**。

### 人物负面词（逐字复用）

```text
negative: illustration, painting, digital art, concept art, 3D render, CGI, anime, cel shading,
cartoon, plastic skin, airbrushed skin, beauty filter, glamour lighting, fashion model pose,
glossy hair, oversaturated colours, modern clothing, extra limbs, different faces between views,
inconsistent character, three different people, changing proportions between views,
watermark, text, logo
```

> **`different faces between views` / `three different people` 这两条不能省。** 三视图最常见的失败就是三个视图长成三个人。

### 免责句（按平台要求决定要不要加）

```text
画面中没有出现可识别的名人或虚构角色。
No identifiable real person or fictional character is depicted.
```

---

## 七、一致性七条铁律（写完提示词后的最后一步）

从全部素材里压出"破了整套图就废"的约束，一般 5–7 条。**写在项目文档开头，每出一张图回头对一遍。**

| 类型 | 例 |
|---|---|
| **共用特征** | 主角与女主同为"平直眉"——这是本书"同类人"的视觉暗号 |
| **状态继承** | 第 X 章之后主角一律"左臂吊布"，不可漏、不可提前 |
| **阶层标记** | 剥削者的手粗、掌权者的手净，两列不可混 |
| **颜色归属** | 银色只属于某体系；暖橙只给火堆与母亲 |
| **饱和度约束** | 红色克制，某件战袍必须是"发浊的暗红"而非鲜红 |
| **图形语法** | 白格网 vs 黑圆纹，永不同色、方向相反 |
| **质感等级** | 穷苦物件必磨损，权力物件必光洁 |

### 超自然设定 → 图形语法（最有价值的一步）

把能力翻译成**可重复出现的图形**，全书统一：

```
设定：星力 = 由上而下施加的秩序
图形语法：横平竖直的白色规整格网（a white lattice grid, strict horizontal and vertical lines）

设定：吞噬 = 由内向外、无规则
图形语法：缓慢旋转的墨黑圆纹（a faint slowly rotating dark circle）

约定：二者永不同色、方向相反——出现在同一画框时就是主题句
```

### 色调走向表（跨场景一致性的总纲）

场景批最容易犯的错是"一张一个色"。做法：**按叙事段落先定一张色调走向表，逐张对照。**

| 段落 | 主色调 | 光源 |
|---|---|---|
| 起点 | 铁锈褐 + 冷青灰 | 油灯、天光从高处漏下 |
| 中段 | 惨白日光 + 冷灰 | 无影顶光、高窗斜光 |
| 转折 | 火光红与纯黑 | 火、灯笼 |
| 高潮 | 惨白 → 纯白空屏 → 暗金 | 冷白光、自发光 |
| 收束 | 冷白 → 冷青灰 → 纯黑 | 天光、篝火（唯一暖点） |

> **暖色是稀有资源**——在一个色调区间里给暖色留出明确额度，全都用暖色等于没有暖色。

---

## 八、成品示例：反向拆解一段现成提示词

下面是用户给的一段现成提示词，按本模板拆开看它每部分对应哪一段——**照这个方式拆一遍，你就知道自己的素材该往哪儿填。**

**原句**

> 这是一组以纯白背景为底的时尚造型拼贴图，左侧为一张人像特写，右侧分为三个穿搭视角。左侧展示一位年轻东亚女性的近景特写，她皮肤白皙，深色眼眸，黑色头发搭配空气刘海和低马尾；她身穿一件廓形黑色西装外套，内搭领口敞开的白色纽扣衬衫，目光平静地望向镜头。中间和右侧面板从正面、侧面和背面三个角度展示同一套穿搭。整体搭配包括方正剪裁的黑色西装外套、白色衬衫、宽松黑色长裤和黑色皮质乐福鞋，并搭配一只米白色帆布单肩托特包。背面视角可见低马尾和西装后背的接缝线。整体风格极简、单色调、中性化，是典型的韩系街头穿搭风格。画面中没有出现可识别的名人或虚构角色。

**拆解**

| 模板段 | 原句对应 |
|---|---|
| **版式声明** | 「以纯白背景为底的时尚造型拼贴图，左侧为一张人像特写，右侧分为三个穿搭视角」 |
| **① 主体** | 「年轻东亚女性」 |
| **② 定义性特征** | 「皮肤白皙，深色眼眸，黑色头发搭配空气刘海和低马尾」（**注意：②段只有 3 项，克制是对的**） |
| **③ 服装与道具** | 「廓形黑色西装外套 / 领口敞开的白色纽扣衬衫 / 宽松黑色长裤 / 黑色皮质乐福鞋 / 米白色帆布单肩托特包」 |
| **④ 姿态与表情** | 「目光平静地望向镜头」 |
| **背面要点** | 「背面视角可见低马尾和西装后背的接缝线」← **这一句是三视图的灵魂，缺了就只是三张照片** |
| **一致性硬钉** | 「中间和右侧面板从正面、侧面和背面三个角度展示同一套穿搭」（等价于 `the same person in all three views`） |
| **风格锚串** | 「极简、单色调、中性化，韩系街头穿搭」 |
| **免责句** | 「画面中没有出现可识别的名人或虚构角色」 |
| **缺项 ⚠️** | 没有**磨损**（一双全新的乐福鞋 / 崭新的帆布包）；没有**光**（只有"纯白背景"）——若要出剧情感更强的角色图，这两项必须补 |

**改造版（补上缺项，换成有故事的角色）**

```text
这是一组以中性中灰背景为底的真人写实角色设定稿拼贴图，左侧为一张人像特写，右侧分为三个穿搭视角。
左侧展示一位十六岁东亚少年，肤色晒黑偏黄，深褐色眼眸、眼神半垂平静，黑色略长的头发不束、额前碎发遮住左眼；
他身穿洗白磨破的灰褐粗麻短褐，腰间一根麻绳，赤脚，目光平静地望向镜头。
中间和右侧面板从正面、侧面和背面三个角度展示同一套服装。整体搭配包括磨破袖口的粗麻短褐、麻绳腰带、
参差下摆和赤脚草鞋，并搭配一只藤条编的矿石背筐。背面视角可见右肩上一道被麻绳勒出、结了痂又裂开的旧伤，
以及背上纵横的旧疤。整体风格粗粝、低饱和、纪实，是典型的矿区苦役装束。
三个视角必须是同一个人、同一姿势、同一比例、同一光。画面中没有出现可识别的名人或虚构角色。
```

再看它的**背面要点**：原例的"低马尾 + 西装后背接缝线"是**服装信息**，改造版的"绳勒伤 + 背上的旧疤"是**身体信息**。三视图里能写身体信息时优先写身体——服装可以换，伤换不掉。

---

## 九、交付前检查清单

- [ ] 每条提示词**可整段复制**，不留 `[待填]`
- [ ] 六段齐全：主体 / 定义性特征 / 服装与道具 / 姿态与动作 / 环境与光 / 镜头与画幅
- [ ] 固定尾缀**跨图逐字一致**
- [ ] 每个重要角色至少有一条**只属于他**的辨识点
- [ ] 每个角色至少有一条**背面 / 侧面**特征（三视图专用）
- [ ] 磨损细节已写（穷苦必磨损；掌权者显式写 `unworn`）
- [ ] 光源**写了方向、性质、色温**，不是"好看的光"
- [ ] 主色调**不超过三个色**，暖色有明确额度
- [ ] 场景图**人不可辨识**（概念图）；且只写场景里真实存在的光源
- [ ] 道具图**画面里零个人物痕迹**（无手、无指头、无模特）；底为平色无缝，无强烈投影
- [ ] 道具的**磨损位置与刻字内容**已写死，同一件道具跨图逐字一致
- [ ] 尺度有**数字或参照物**
- [ ] 三视图为**平光、无表情、中性立姿**；场景图为**单光源、强方向**
- [ ] 画面里**零个规格文字**（色值、字段名、参考线、标注）
- [ ] 尺寸写在 `size` 参数里，**没有写进提示词正文**
- [ ] 锚点图**面部完整露出**，且已经用户确认
- [ ] 派生图**实际传入了锚点图**（不是只靠文字说"跟上一张一样"）
- [ ] 每张图**读回来看过**再下判断
- [ ] 人物 / 场景 / 道具的负面词各用了对应那一套
- [ ] 一致性七条铁律已逐条对过

---

## 十、参数对照表

| 图种 | 比例 | `size` | `quality` | 输出目录建议 |
|---|---|---|---|---|
| 人物三视图 · 一图三面 | 3:2 横 | `1536x1024` | `high`（基准图，不省） | `<项目>/art/turnaround/` |
| 人物三视图 · 一图一面 | 2:3 竖 | `1024x1536` | `high` | 同上 |
| 人物半身标准像（锚点） | 2:3 竖 | `1024x1536` | `high` | `<项目>/art/portrait/` |
| 人物特征微距（异瞳、伤、手） | 1:1 方 | `1024x1024` | `medium` | 同上 |
| 场景概念图 | 3:2 横 | `1536x1024` | `high` | `<项目>/art/scene/` |
| 场景气氛图 | 3:2 横 | `1536x1024` | `medium` | 同上 |
| 名场面定格 | 3:2 横 | `1536x1024` | `high` | `<项目>/art/keyframe/` |
| 道具档案图 | 1:1 方 | `1024x1024` | `high` | `<项目>/art/prop/` |
| 道具多角度档案图（关键道具） | 3:2 横 | `1536x1024` | `high` | 同上 |
| 道具状态变体 | 1:1 方 | `1024x1024` | `medium` | 同上 |

**中英取舍**

| 内容 | 用什么 |
|---|---|
| 画面描述 | **英文最稳**（主流模型对英文短语串的权重分配最准）；国产模型可直接用中文骨架 |
| 专有名词（人名、地名、功法名） | 拼音或英文意译：`Lin Yan` / `Luoyan Pass` / `Qingyang City` |
| 需要画在画面里的汉字 | 明确写出且**只写短的**：`four carved characters faintly glowing on the surface` |
| 负面词 | 英文 |
| 给用户看的说明 | 中文 |

> **不要把整段中文译文塞进英文 prompt**——模型会当成"要求画面里出现中文文字"。

---

## 十一、常见失败与修法

| 症状 | 原因 | 修法 |
|---|---|---|
| 三个视图长成三个人 | 模型把"三视图"理解成"三个人" | 骨架里 `the same person` / `consistent scale` **前置**；负面词加 `three different people`；仍不行改走**版式 C 一图一面** |
| 只有正面清晰，侧面背面糊 | 模型把背面当背景处理 | 骨架里明确 `back view on the right`，并**给背面写内容**（背面要点） |
| 画面出现戏剧阴影 | 沿用了剧照的光描述 | 光改成 `soft even studio key light, subtle fill from both sides`；负面词加 `dramatic shadow, chiaroscuro` |
| 滑向插画 / 3D | 缺了"真人三支柱"中任意一根 | 补齐皮肤写实词 + 具体机型镜头 + `no stylisation` |
| 角色被画老 | 模型默认成熟化 | 补 `adolescent, smooth unlined cheeks` |
| 画幅挤，人物被裁掉脚 | 用了方形或竖幅 | 改 `1536x1024`；骨架补 `full body head-to-toe visible, generous margin` |
| 服装细节比剧照还花哨 | 缺少磨损约束 | 补磨损词；权力角色的 `unworn` 也要显式写 |
| 场景图像游戏关卡 | 模型自作主张加光效 | 用场景专属负面词；只写场景里真实存在的光源；给每处表面加材质损伤 |
| 场景图里有张能看清的脸 | 没写"不可辨识" | 概念图补 `tiny unidentifiable figures for scale, none of the faces distinguishable` |
| 数量词出得不对（两盏出四五盏） | 数量词权重不够 | 数量**提到句首**并强调：`exactly two small oil lamps, the only two points of light in the entire frame`；接受一定偏差，别为数量单独重出一整批 |
| 人小如蚁被画大 | 极端比例被模型"舒服化" | 三条同时写：尺度数字 + 微小参照物 + 比例判断（`absurd scale contrast, the figure tiny in frame`） |
| 一套图五种画风 | 每张各自描述风格 | 抽一段固定的**风格锚串**逐字复制到每条末尾 |
| 派生图跟锚点不像 | 只用文字说"跟上一张一样" | 必须把锚点图**实际传进** `image1`，`input_fidelity` 调高 |

---

## 十二、平台出图工具调用要点

| 参数 | 用法 |
|---|---|
| `prompt` | 六段式全文 + 固定尾缀（负面词若模型不支持独立字段，就删掉，别硬塞正文） |
| `size` | 按第十节表。**尺寸不要写进 prompt** |
| `quality` | 锚点图 `high`，批量派生 `medium` |
| `output_dir` | 统一输出到 `<项目>/art/`，便于成套核对 |
| `image1` / `image2` / `image3` | 派生图时传锚点图（本地绝对路径或 URL），最多 3 张 |
| `input_fidelity` | 图生图时调高，风格漂了就往上加 |

**四条硬约束**

1. **必须先告知消耗**：单张图约 5–10 credits。批量出图前把张数与预估消耗报给用户，等确认再跑。
2. **一次不要跑太多张**：先锚点，再小批（3–5 张），核对后再继续。
3. **平台可能自动打水印**：prompt 里写否定词**没有用**；交付时要主动告知用户水印存在，要去掉只能走图生图重绘或后续图像处理。
4. **中文专有名词处理**：人名地名用拼音或英文意译，不要把中文方块字塞进 prompt。

---

## 附：最小可用流程（七步）

1. 找素材真源（设定文档 / 参考图描述 / 分镜表）→ 建立人物与场景清单
2. 按清单采集：人物 8 项 + 关键姿态；场景 6 项
3. 写下**一致性七条铁律**，放进项目文档开头
4. 按六段式写提示词，人物选一个版式、场景按三类分，尾缀逐字一致
5. **先出主角锚点图**（1 张）+ 必要的主场景概念图（1 张），交用户确认
6. 以锚点为 `image1` 派生，每批 ≤5 张，逐张读回核对
7. 交付：提示词文档写进项目目录，图片用 `present_files` 展示并给绝对路径
