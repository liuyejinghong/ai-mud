# 《余电》v1.0 验收记录（线上阻塞版）

> **验收状态：BLOCKED。没有完成线上从头到尾试玩，不是“已通关”或“全功能验收通过”报告。**
> 目标站点已复现的游戏缺陷：**0 项**。下列 **P0 候选 1 项、P1 候选 6 项、P2 候选 3 项**均来自代码核验；独立实验不等于目标站点复现。

## 1. 对象、版本与边界

| 项目 | 本轮记录 |
| --- | --- |
| 日期 | 2026-09-20；已保存实验时间 14:25:33—14:32:55 UTC（北京时间 22:25:33—22:32:55） |
| 仓库／关联 PR | `liuyejinghong/ai-mud`；实现 PR [#20](https://github.com/liuyejinghong/ai-mud/pull/20) |
| 审查分支 | `v0.12.0-base-operations`；分支名不是当前产品版本 |
| 固定审查提交 | `fad7d4232937d6c3fb216d743edb227589846803` |
| 版本依据 | 该提交的 [发布说明][S12]声明 `v1.0.0`；实际运行站点的部署 SHA **未取得**，不得断言与本提交完全一致 |
| 阶段 | 暂按文字原型／内部测试版校准；不以没有像素画面、动画或音效判错 |
| 入口 | 用户提供的 HTTP 试玩入口，端口 8088；公共报告不收录主机地址或凭据 |
| 工具与视口 | Playwright＋Chromium `144.0.7559.96`；首次访问视口 1440×1000 |
| 账号与存档 | 未提交登录凭据，未注册账号，未进入基地；未修改所有者存档、数据库或配置 |
| 实际在游时长 | **0 秒**；工具排查及读代码时间不计为玩家游戏时间 |
| 覆盖 | 32 组计划检查：30 组因入口阻塞未执行，2 组还需隔离环境；游戏流程通过数为 0 |
| 玩法裁决 | **无法裁决好玩／勉强／不好玩**；缺少现场操作、选择后果和连续循环证据 |

范围按基地经营版，而不是 `main` 上的旧西幻玩法。发布说明将旧战斗／职业／市场标为新基地不可达，因此没有把那些旧功能列成“新版缺失”。这轮未执行仓库测试、构建、类型检查、真 PostgreSQL、真实模型或真人试玩；不沿用历史 PR 的绿灯作为本轮结果。[S12][S12]

本 PR 只新增验收文档及脱敏证据，不修游戏代码、不改部署、不合并实现 PR、不发布内容。

## 2. 已发生的访问阻塞与独立实验

### ENV-01：当前执行环境阻止访问目标站点（不计产品 P0）

直接请求曾得到连接拒绝；随后浏览器首次导航明确返回：

```text
Page.goto: net::ERR_BLOCKED_BY_ADMINISTRATOR
Chromium: 144.0.7559.96
Credentials submitted: false
```

截图显示浏览器的组织访问限制页，不是游戏界面。**这不能证明服务器停机、登录失败或项目存在 P0 游戏设计缺陷。**明确限制后未尝试绕过访问策略。脱敏记录见 `E01`；原始截图仅随本次会话附件提供，未上传公共仓库。

### 证据等级与实验清单

| 编号 | 已执行内容 | 能证明什么 | 不能证明什么 |
| --- | --- | --- | --- |
| E01 | 目标入口的一次 Chromium 导航，保存错误与截图 | 本执行环境的导航被阻止 | 游戏服务器状态、任何玩家操作结果 |
| E02 | 无网络请求的 `about:blank` 非安全上下文 API 实验 | `isSecureContext=false`；`crypto.randomUUID` 为 `undefined`；调用抛 `TypeError` | 目标站点具体部署、是否另有 polyfill、完整开工链 |
| E03 | 从源码提取的角色表达式与设备汇总纯函数 | 嵌套 admin／super_admin 被表达式转换为 player；0／1／20 台全离线输入都输出“12 台就位” | 目标站点真实账号角色或设备状态 |
| E04 | 独立 ARIA 模态标记的浏览器实验，不加载游戏组件 | 单有 `role=dialog`／`aria-modal=true` 不会阻止 Tab 进入背景，也不自动处理 Escape | 游戏整页的最终键盘行为与视觉布局 |

完整结构化记录及 32 组覆盖状态见 [脱敏证据 JSON](2026-09-20-acceptance-evidence.json)。`E02—E04`均不是游戏 E2E，不计入线上通过数。

## 3. 分级口径与问题总表

**P0**：在成立的部署条件下，核心入口／行动链被阻断，需先处理再继续完整验收；本轮 P0 是技术候选，不是已证实的设计范式错误。**P1**：会话、反馈、决策信息或输入行为妨碍使用。**P2**：不直接阻断主流程的文案、重复操作与引导粒度问题。

严重度与置信度分开：本轮“高置信”只表示源码条件和推理链明确，**所有目标站点状态仍为待确认**。转段标签“保留”表示转像素后仍需解决，不是保留缺陷。没有为了凑 P0 将访问限制升级，也没有以“原型期”为理由豁免核心信息与连续操作。

| ID | 候选优先级 | 问题 | 依据 | 目标站点状态 | 转段 |
| --- | --- | --- | --- | --- | --- |
| TECH-01 | P0 | HTTP 试玩入口与 crypto.randomUUID 安全上下文要求冲突 | 高；独立浏览器 API 已复现，目标部署待确认 | 待确认 | 保留 |
| AUTH-01 | P1 | 普通玩家刷新恢复会话后，CSRF 状态可能一直停在 null | 高；代码调用链 | 待确认 | 保留 |
| AUTH-02 | P1 | 管理员登录时读取错误的角色字段，被前端当成 player | 高；服务端合同＋独立表达式复现 | 待确认 | 保留 |
| SYNC-01 | P1 | 快照失败被静默吞掉，加载与陈旧状态缺少可恢复反馈 | 高；代码分支 | 待确认 | 保留 |
| ECON-01 | P1 | 订单交付期限与采购到货时间没有呈现给玩家 | 高；DTO 与渲染对照 | 待确认 | 保留 |
| BUILD-01 | P1 | 开工前没有材料清单、库存缺口与量化产出预览 | 高；内容定义与渲染对照 | 待确认 | 保留 |
| UX-01 | P1 | 新手模态框没有焦点管理与背景输入隔离 | 高；代码＋独立 ARIA 平台实验 | 待确认 | 保留 |
| UX-02 | P2 | 引导关闭标记按浏览器共用，新账号也会跳过 | 高；状态键与显示条件 | 待确认 | 保留 |
| UX-03 | P2 | 设备汇总在零设备或全部离线时硬编码“12 台就位” | 高；独立纯函数复现 | 待确认 | 保留 |
| ECON-02 | P2 | 采购只能逐件下单，无法使用已有数量合同批量采购 | 高；UI 与 API 合同对照 | 待确认 | 保留 |

## 4. P0 候选

### TECH-01 — HTTP 入口使用安全上下文限定 API，可能直接阻断开工

**静态事实。** [部署文件][S01]明确使用 HTTP、`8088:80`，并为 HTTP 关闭 Secure cookie。[ObjectPanel 的开工按钮][S02]在调用 `onCreateProject` 前直接计算 `commandId: crypto.randomUUID()`；[BaseApp][S03]的取消项目／制造、接单、交付、采购也调用该 API。[已检查入口][S13]、[App][S04]和[baseApi][S05]没有提供对应兼容处理。Web Crypto 将该 API 限定在安全上下文；普通公网 HTTP 与 localhost 的开发环境不能混为一谈。[W01][W01] [W02][W02]

**独立复现 E02。** Chromium 在非安全 `about:blank` 文档中返回 `isSecureContext=false`、`typeof crypto.randomUUID === "undefined"`，执行同一表达式得到 `TypeError: crypto.randomUUID is not a function`，后续命令未被调用。实验没有访问目标站点，也没有加载游戏构建产物。

**预计影响与限定。** 若部署确实采用审查代码，且玩家使用未特殊配置、无额外兼容处理的普通 HTTP 浏览器环境，首次“在这里建设”会在发请求前抛错。注册能成功不代表能开工。目标站点是否重定向到 HTTPS、注入兼容层或使用不同提交尚未确认，因此记为 **P0 候选／高置信条件风险**，不写“线上已复现”。

**复验。** 在可访问环境用全新普通浏览器上下文打开同一入口；只读检查 `window.isSecureContext` 与 `typeof crypto.randomUUID`；登录可丢弃账号，尝试开工，并关联点击、控制台异常和网络请求。随后覆盖制造、取消、接单、交付、采购。不要靠关闭浏览器安全限制使测试通过。

**通过标准与建议。** 首项工程请求成功发出并获得可见结果；全部命令 ID 入口无该异常。优先部署有效 HTTPS；临时 HTTP 兼容须统一、显式检测并使用适当的随机 ID 实现，不能以移除 CSRF 或削弱浏览器安全策略代替修复。

## 5. P1 候选

### AUTH-01 — 普通玩家硬刷新时 CSRF 初始值不会跟随恢复的会话更新

**静态事实。** [App][S04]首次 `session=null` 就渲染没有 `initialCsrfToken` 的 BaseApp，随后异步 `/auth/me` 恢复 session。普通玩家分支仍在同一位置返回 BaseApp，没有改变 key；[BaseApp][S03]只用 `useState(initialCsrfToken)` 初始化本地 token，未同步后续 prop。React 的初始化参数在首次渲染后不会重新应用。[W03][W03]

**预计影响。** 既有 cookie 的普通玩家刷新后，快照可能正常显示，但组件本地 token 仍为 null；[时钟按钮][S07]被禁用，多条行动 handler 静默 return，心跳也不启动。管理员恢复会话时有不同包装层，不应只用所有者账号测试后认定普通玩家通过。

**复验。** 先用普通账号正常登录，再硬刷新；记录 `/auth/me`、`/base/snapshot`、按钮状态和下一次心跳。此项可先只操作不依赖 UUID 的恢复／暂停按钮，与 TECH-01 分开定位。

**通过标准与建议。** 恢复会话后无需退出重登即可操作，CSRF 与有效 session 一致，心跳正常。统一会话真源，或在 hydration 完成前不挂载可操作基地；不要用无条件 prop 覆盖新登录刚取得的有效 token。

### AUTH-02 — 管理员登录角色从错误的层级读取

**静态事实。** [服务端 `/auth/login`][S06]返回 `{ user: { role, ... }, csrfToken }`，[客户端合同][S05]一致；但[BaseApp 登录成功分支][S03]通知父组件时读 `session.role ?? "player"`，没有读 `session.user.role`。[App][S04]只给 `admin`／`super_admin` 显示管理工作区。

**独立复现 E03。** 用符合返回合同的对象代入表达式，`user.role=admin` 与 `super_admin` 都得到 parent role `player`；普通 player 对照则一致。这不是服务端权限提升漏洞，也没有实际登录所有者账号。

**复验。** 已退出状态下登录授权管理员，观察是否立即出现“管理”；刷新再比较。普通账号作对照，不能出现管理入口。

**通过标准与建议。** 登录与 `/auth/me` 恢复路径采用同一个强类型角色合同，管理员无需刷新即可进入管理区；服务端权限校验仍必须独立存在。

### SYNC-01 — 快照失败被静默吞掉，玩家无法区分加载、断线与陈旧数据

**静态事实。** [BaseApp.refreshSnapshot][S03]只特别处理 401，其余错误返回 null；首屏保持“正在连接基地…”，已有 ready 状态则保留旧快照，没有连接错误／最后成功更新时间。确实存在每 5 秒自动轮询，**不是没有重试**。命令成功后的刷新也被这一 catch 吞掉，`runCommand`未必会显示同步失败。心跳错误同样被忽略。

**预计影响。** 持续 500／断网时像无限加载；已进入基地后可能误把旧余额、进度当成当前权威状态，无法判断该等待、重试还是重新登录。尚未测量现场延迟或重复扣款，不能宣称已经发生。

**复验。** 在授权测试环境分别对首次快照、运行中快照和命令后快照模拟断网／500，再恢复；另测 401，不要混为同一种错误。

**通过标准与建议。** 可见连接状态、最后成功同步时间和恢复入口；旧数据明确标为陈旧；重连后更新权威快照。任何重试不得盲目重复执行未知结果的资产命令。

### ECON-01 — 交付期限和到货时间存在于合同，却没有成为玩家可见信息

**静态事实。** [订单与采购 DTO][S09]含 `deadlineSim`、`acceptedAtSim`、`arrivesAtSim`，默认物流延迟为 4 模拟小时；[EconomyBoard][S08]只显示物品、数量、报酬、状态以及“运输途中／已入库”，不呈现这些时间；[BaseShell][S07]没有把当前 simTime 传给经营面板用于统一展示。

**预计影响。** 接单与采购涉及真实等待和期限，玩家却无法在经营现场判断何时交付、何时到货，以及暂停／倍率为什么影响等待。不是单纯美术打磨，也不能用现实墙钟倒计时代替模拟时间。

**复验。** 接一单、采购一批，在暂停和 ×1／×4 下记录经营面板；追踪期限前后与到货前后的反馈。

**通过标准与建议。** 接单前知道期限，接单后看见截止模拟时间；采购前知道延迟，采购后看见预计到货及暂停说明。开放订单目前未必携带期限长度，必要时补服务端只读合同，不在前端猜测。

### BUILD-01 — 玩家按下开工前，看不到精确成本与收益

**静态事实。** [开工详情][S02]的 BuildableTemplateDto 仅有 ref／name／description；空地面板展示名称、描述和“在这里建设”，没有材料清单、拥有／缺口或量化产出。[默认项目定义][S11]实际需要电池组件 6、支架 6、线缆 2、配电单元 1、锚固件 8，完成增加 5000 W 峰值发电；描述本身没有列出这些数值。

**预计影响。** 玩家难以在建设与交单／制造之间分配同一批库存；按下后才知道缺什么或花掉什么。此项是决策信息缺失，**不等于已证明玩家没有有效选择或游戏不好玩**。

**复验。** 在满料、差一种材料、与订单争用库存的可丢弃存档中，打开建设位而不提交；仅凭游戏界面说明成本、缺口、产出及受阻条件，再执行并比对。

**通过标准与建议。** 开工前就能查看所需／持有／缺口、作业条件、预期产出和消耗规则；不确定工期说明受电力与调度影响，不能给无依据的固定倒计时。文字表格已足够，不依赖未来像素表现。

### UX-01 — 新手模态框没有真正限制键盘输入范围

**静态事实。** [BaseIntroModal][S10]是带 `role="dialog"`、`aria-modal="true"` 的普通 section，只绑定“开始指挥”的 click；没有初始聚焦、Tab 循环、背景 inert、关闭后焦点回归或 Escape 处理。[BaseApp][S03]将它与可操作 BaseShell 同时渲染。E04 平台实验表明这些 ARIA 属性本身不提供模态输入行为；W3C 模态模式要求焦点留在对话框内。[W04][W04]

**预计影响。** 仅键盘玩家可能在引导仍覆盖时把焦点移到后台控件，造成不可见操作；现场视觉和整页行为仍待复验。Escape 是否允许关闭可按产品选择，但不能放任背景控件接受焦点。

**复验。** 新账号首次引导打开后，连续 Tab／Shift+Tab，检查每次 activeElement；测试允许的关闭方式与关闭后焦点；确认背景未被触发。

**通过标准与建议。** 打开即把焦点移入，循环停留在模态内，背景不可交互，关闭后回到合理操作点。可用原生 dialog 的模态行为或完整焦点管理，不是只补 ARIA 标签。

## 6. P2 候选

### UX-02 — 同浏览器的新账号会继承旧账号“已看过引导”

**事实与影响。** [BaseApp][S03]统一使用 `localStorage["base-intro-dismissed"]`，显示条件是“无项目且未关闭”；没有账号／baseId／引导版本维度。同一浏览器里 A 关闭后，B 新注册也不会显示该引导。是否已经影响真实新玩家未知。

**复验与通过标准。** 用两个可丢弃账号顺序登录同一浏览器，B 应得到自己的首次引导；按账号／基地与引导版本记录，并提供主动重看入口。避免把清空整个浏览器存储当恢复方案。

### UX-03 — 队伍状态的兜底数字与实际设备数不一致

**事实与独立复现。** [BaseShell.fleetStatus][S07]只统计 working／charging／idle，三者为零时硬编码“工程队：12 台就位”。E03 输入 0 台设备、1 台离线设备、20 台全离线设备，均输出同一句；这证明纯函数文案与输入数量不符，但没有证明线上曾出现这些状态。

**复验与通过标准。** 在测试快照中覆盖零台、全离线、制造后超过 12 台及混合状态；总数与状态统计应与设备清单一致，明确“无设备／全部离线”，不使用开局固定数量兜底。

### ECON-02 — 采购数量合同存在，界面却只允许买一件

**事实与影响。** [采购 API 合同][S09]已有 quantity，[PurchaseRow][S08]固定 `onPurchase(itemId, 1)`。默认支架订单需要 6 件，[S11][S11]故仅为补足这单就需要 6 次单件购买命令；这只是代码可数的操作次数，**不是现场测得的耗时**。它不直接阻断交易，列为 P2，不升级为循环崩溃。

**复验与通过标准。** 对比补 1 件与补 6 件的流程；增加合法数量、总价、余额限制与到货说明，一次命令创建相应采购，不把多次单件点击当批量操作。保持服务端数量与余额校验。

## 7. 从头到尾覆盖表：全部保留真实状态

下面是按当前发布说明和代码入口制定的**复验计划**，不是已执行日志。32 组中，G01—G30 为 `BLOCKED_ACCESS`；G31—G32 为 `NOT_RUN_REQUIRES_ISOLATED_ENVIRONMENT`。每组恢复执行后应追加版本、会话、初始状态、操作、实际响应、截图／交互编号和结果，不能直接把本表改成全绿。

| 组 | 范围 | 验收观察 | 本轮状态 |
| --- | --- | --- | --- |
| G01 | 首次试玩注册→基地→新手引导 | 不查外部文档能说清身份、近期目标、如何开工；新账号状态独立。 | BLOCKED |
| G02 | 注册输入与失败恢复 | 空值、邮箱格式、重复邮箱、密码边界；错误可读且不重复创建基地。 | BLOCKED |
| G03 | 已有普通账号登录 | 正确／错误密码、受限账号、会话过期；失败不残留可操作状态。 | BLOCKED |
| G04 | 普通玩家硬刷新恢复会话 | 已有 cookie 后刷新，CSRF 恢复、时钟按钮可用、心跳可续租。 | BLOCKED |
| G05 | 所有者／管理员登录 | 登录立即得到正确工作区；不靠刷新才显示管理入口。 | BLOCKED |
| G06 | 退出、返回与账号切换 | 退出后不能继续操作旧账号；新账号不承接旧选择或引导标记。 | BLOCKED |
| G07 | 地图与对象选择 | 逐开建成设施、建设位、设备、资源、项目；返回后上下文一致。 | BLOCKED |
| G08 | 开工前决策 | 展示成本／拥有／缺口、作业要求、产出；条件不足有可理解原因。 | BLOCKED |
| G09 | 首项工程完整四步 | 清场→运输→安装→验收；真实扣料、推进、受阻与并网一致。 | BLOCKED |
| G10 | 工程取消与退款 | 开工前、进行中、临近完成取消；区分已消耗／未消耗，重复操作不双退。 | BLOCKED |
| G11 | 完工与下一目标 | 默认内容 15→20 kW 的峰值变化可读；不把峰值误当实时出力；能找到下一目标。 | BLOCKED |
| G12 | 设备与充电 | 三组设备的分工、任务、电量、充电、待命／离线与汇总一致。 | BLOCKED |
| G13 | 制造与成长 | 两个默认配方、单台与批量；成本和逐台产出正确，新设备有可验证用途。 | BLOCKED |
| G14 | 制造取消 | 部分已产出时取消，保留产出、退未耗料；刷新后不重复产出。 | BLOCKED |
| G15 | 协作与规则决策 | 触发跨组支援，申请／批准／执行能追溯；不把 RULE 声称为真实模型。 | BLOCKED |
| G16 | 暂停、恢复与倍率 | ×1／×2／×4，暂停不推进模拟时间；恢复不补算已声明暂停段。 | BLOCKED |
| G17 | 关页与重进 | 关闭页面、等待租约到期、重进；离线政策与可见说明一致。 | BLOCKED |
| G18 | 后台标签与多标签 | 切后台、双标签、重新前台；计时与续租政策明确，状态不互相覆盖。 | BLOCKED |
| G19 | 昼夜能源 | 跨 06:00／18:00，发电、负载、储能与停工可解释；无负资产。 | BLOCKED |
| G20 | 尘暴与维护恢复 | 预警→遮光→积尘→清理／维护恢复；逐段验证发布说明所承诺的入口。 | BLOCKED |
| G21 | 订单正常闭环 | 接单→备料→交付→扣库存／到账；余额与订单状态持久一致。 | BLOCKED |
| G22 | 订单期限与失败恢复 | 接单前知道期限，超时结果可读；失败状态、材料和账款不矛盾。 | BLOCKED |
| G23 | 采购与物流 | 余额不足、重复提交、4 模拟小时在途、暂停／恢复、到货只入库一次。 | BLOCKED |
| G24 | 三圈经营与策略比较 | 对比建设／制造／采购交付的代价、等待、风险与收益；记录真实 5／15／30 分钟状态。 | BLOCKED |
| G25 | 耗尽后的可恢复性 | 仅可丢弃账号测试缺电、缺料、零账款；验证不靠管理员补档也能恢复的规则。 | BLOCKED |
| G26 | 模态框与输入连续性 | Tab／Shift+Tab／Escape、焦点回归、滚动、对象选择、开关面板不丢上下文。 | BLOCKED |
| G27 | 移动端与窄屏 | 390×844 及横屏；按钮可点、详情可读、无关键内容被遮挡或横向溢出。 | BLOCKED |
| G28 | 请求失败与网络恢复 | 401／500／断网／恢复；显示陈旧状态，重试不重复扣款，恢复后显示权威数据。 | BLOCKED |
| G29 | 进度与资产持久化 | 取得材料／设备／账款后刷新、退出重进，账实一致且属于同一账号基地。 | BLOCKED |
| G30 | 管理后台只读巡检 | 全部导航、内容草稿／发布列表、审计、版本；不激活或改变共享世界。 | BLOCKED |
| G31 | 账号隔离与权限负例 | 仅隔离环境、自建两个测试账号；交叉访问被拒绝，普通账号不能管理。 | NOT_RUN／需隔离 |
| G32 | 内容完整生命周期 | 隔离环境中草稿→校验→发布→激活→回退；不得拿共享试玩环境做破坏性发布。 | NOT_RUN／需隔离 |

## 8. 玩法层面仍欠缺的证据

**像不像游戏。** 需要实际开关对象／工程／制造／经营面板，观察地点、选择、输入、阅读位置与行动是否连续；路由有没有变化不是裁决本身。

**选择有没有意义。** 对比建设、制造与采购交付，在可比状态下记录成本、风险、时间、实际用途和下一目标。不能仅因为固定价格存在差价就断言玩法无意义，也不能仅因为数值增长就宣称成长成立。

**循环能否延续。** 至少走三圈，并观察首项工程完成后的可用建设位、材料来源、订单与设备用途。发布说明已承认内容规模有限，不能把内容少直接等同于 P0；也不能因此跳过下一步是否存在的验证。

**失败后能否恢复。** 缺电、缺料、期限失败、取消与断线都要在可丢弃存档验证。没有实际记录，不给乐趣评分、留存预测或“真人体验结论”，也不为凑报告编造亮点。

## 9. 暂不计入缺陷的疑点与撤回边界

- **“目标服务已宕机”不成立。** E01 是当前执行环境的限制，缺少独立服务端可用性证据。
- **“所有过期订单会永久停在进行中”证据不足。** [交付服务][S14]确有先写 failed 再抛异常的分支，且[用例][S15]有事务；但[订单仓储][S16]同时存在 `markExpiredOrders`。没有完成时钟／清理调用链与真库复验，不能把局部回滚推演写成普通玩家必现卡死，本轮不计问题数。
- **后台页签是否应暂停需澄清并实测。** 快照轮询有 visibility 判断，心跳没有同样的判断；但“关闭页面”与“切后台”的政策不能混写。没有实际资源变化证据，不报告离线丢物资。
- **旧版缺失与未来像素制作不属于本轮缺陷。** 不要求重开旧西幻战斗，不以未制作动画／音效／像素画面扣分；只验证当前文字承诺是否兑现。

## 10. 后续验收顺序与退出条件

先取得**本执行环境获准访问**的入口，并记录实际部署 SHA；若部署不同，逐条重验本报告候选，不直接沿用结论。优先排除 TECH-01，再用普通账号验证 AUTH-01，而不是只用 owner 账号。完成首项建设→制造→订单→采购→再投资、失败恢复和三圈对比，再补窄屏、断线与隔离环境管理测试。

达到“可验收”至少需要：32 组逐项有执行记录或明确获批的排除理由；P0 候选已在实际部署验证并处理；P1 有复验结果和接受／修复决定；关键资产前后值、会话连续性和恢复路径可核对。**本 PR 的合并只归档证据，不表示游戏通过，也不表示自动合并 PR #20。**

## 11. 复验用只读探针与资料

下面可在获准访问的目标页面开发者工具中只读检查环境；不读取账号、cookie 或 token：

```js
({
  secureContext: window.isSecureContext,
  randomUUIDType: typeof globalThis.crypto?.randomUUID,
  getRandomValuesType: typeof globalThis.crypto?.getRandomValues
})
```

E03 的角色表达式可用纯 JavaScript 复核，不代表访问服务端：

```js
const response = { user: { role: "admin" } };
const parentRole = response.role ?? "player";
console.log(parentRole); // player；与 response.user.role 不同
```

### 固定提交源码索引

- [S01 · `deploy/docker-compose.prod.yml`][S01]
- [S02 · `apps/web/src/features/base/ObjectPanel.tsx`][S02]
- [S03 · `apps/web/src/features/base/BaseApp.tsx`][S03]
- [S04 · `apps/web/src/App.tsx`][S04]
- [S05 · `apps/web/src/features/base/baseApi.ts`][S05]
- [S06 · `apps/server/src/modules/auth/auth.routes.ts`][S06]
- [S07 · `apps/web/src/features/base/BaseShell.tsx`][S07]
- [S08 · `apps/web/src/features/base/EconomyBoard.tsx`][S08]
- [S09 · `packages/shared/src/economy.ts`][S09]
- [S10 · `apps/web/src/features/base/BaseIntroModal.tsx`][S10]
- [S11 · `packages/content/src/base/default-release.ts`][S11]
- [S12 · `docs/releases/v1.0.0.md`][S12]
- [S13 · `apps/web/src/main.tsx`][S13]
- [S14 · `apps/server/src/modules/economy/order.service.ts`][S14]
- [S15 · `apps/server/src/application/economy/usecases.ts`][S15]
- [S16 · `apps/server/src/modules/economy/order.repository.ts`][S16]
- [S17 · `apps/server/src/modules/world-runtime/base-session.routes.ts`][S17]

### 浏览器与框架依据（2026-09-20 查阅）

[W01 · MDN randomUUID 安全上下文说明][W01]；[W02 · Web Crypto API][W02]；[W03 · React useState 初始化参数][W03]；[W04 · W3C 模态对话框键盘模式][W04]。

[S01]: https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/deploy/docker-compose.prod.yml
[S02]: https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/apps/web/src/features/base/ObjectPanel.tsx
[S03]: https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/apps/web/src/features/base/BaseApp.tsx
[S04]: https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/apps/web/src/App.tsx
[S05]: https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/apps/web/src/features/base/baseApi.ts
[S06]: https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/apps/server/src/modules/auth/auth.routes.ts
[S07]: https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/apps/web/src/features/base/BaseShell.tsx
[S08]: https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/apps/web/src/features/base/EconomyBoard.tsx
[S09]: https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/packages/shared/src/economy.ts
[S10]: https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/apps/web/src/features/base/BaseIntroModal.tsx
[S11]: https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/packages/content/src/base/default-release.ts
[S12]: https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/docs/releases/v1.0.0.md
[S13]: https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/apps/web/src/main.tsx
[S14]: https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/apps/server/src/modules/economy/order.service.ts
[S15]: https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/apps/server/src/application/economy/usecases.ts
[S16]: https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/apps/server/src/modules/economy/order.repository.ts
[S17]: https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/apps/server/src/modules/world-runtime/base-session.routes.ts
[W01]: https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
[W02]: https://w3c.github.io/webcrypto/#Crypto-method-randomUUID
[W03]: https://react.dev/reference/react/useState#parameters
[W04]: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
