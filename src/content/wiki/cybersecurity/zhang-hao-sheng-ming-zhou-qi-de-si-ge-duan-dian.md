---
title: 账号生命周期的四个断点
description: 把入职、转岗、长期未用、离职四个断点拆成可执行的检查：期望权限集重算与双向 diff、SCIM 停用请求和同步日志逐行读、lastLogonTimestamp 与 Kerberos TGT 的失效边界。
createdAt: '2026-11-15'
updatedAt: '2026-11-15'
tags: [账号生命周期, 身份治理, SCIM, 访问控制]
isPinned: false
growthStage: seedling
---

## 一句话定义

账号生命周期管理（identity lifecycle management）是把"人在组织内的状态变化"翻译成"每个系统里账号与权限集合的变化"的一套机制。四个断点——入职（joiner）、转岗（mover）、长期未用（dormant）、离职（leaver）——是这套翻译最容易失真、失真后又最难被发现的四个位置。

判断有没有真做生命周期管理，不看有没有单点登录，只看一件事：一个人换部门 30 天之后，他在旧部门的权限是不是自己消失了。加权限可以靠流程，减权限只能靠机制。

## 组成与角色

| 角色 | 承载系统 | 关键字段 | 职责 | 缺失时的症状 |
|---|---|---|---|---|
| 权威源 authoritative source | HRIS（Human Resources Information System，人力资源信息系统） | `employee_id`、`dept_id`、`job_code`、`manager_id`、`employment_status`、`effective_date` | 只描述"人属于哪个组织单元、在什么日期生效" | 一个系统一套花名册，停用靠人通知 |
| 身份库 identity store | IdP（Identity Provider，身份提供方）／目录服务 | `objectGUID`、`uid`、`active`、`memberOf`、`accountExpires` | 账号主体的唯一标识与启用状态 | 同名账号多个，无法确定主体 |
| 授权层 | 角色表／组／策略引擎 | `role_code`、`resource_id`、`scope`、`expires_at`、`grant_source` | 把组织属性映射成资源权限 | 权限由各系统各写一遍，四份映射迟早不一致 |
| 下游本地账号 | 应用自有 `user` 表 | 应用侧 `user_id`、`tenant_id`、`status` | 应用自己的会话与凭据 | 停用了 IdP，应用里还能登 |
| 对账器 reconciler | 定时任务 | 期望集合、实际集合、差集、执行记录 | 双向比对并输出差集 | 只加不减，权限只增不降 |
| 审计 | 日志／工单系统 | `event_id`、`actor`、`before`／`after`、`rule_version`、`ticket_id` | 证明"某次变更依据哪条规则、由谁批准" | 出事后只有结果，没有依据 |

表里最关键的一行是权威源：它只描述人，不描述权限。权限必须由 `dept_id` 与 `job_code` 用函数算出来——一旦允许"在某系统里手工加一条"，这个系统就成了第二权威源，后面所有对账都以它为准，等于没有对账。

## 一条事件的时序

```
HRIS 事件  { event_id, type, employee_id, effective_date, payload }
  │ ① 落 landing 表（append-only，不改原记录，保留原始 payload）
  ▼
编排器 orchestrator
  │ ② 校验：employee_id 存在、effective_date 合法、event_id 未处理过
  │ ③ 计算期望权限集：roles = rules(dept_id, job_code, location)   规则版本 rules@vN
  ▼
目标系统适配器   SCIM（System for Cross-domain Identity Management，跨域身份管理协议）／LDAP／应用 API／人工工单
  │ ④ 双向 diff：expected − actual 为应加；actual − expected 为应减
  │ ⑤ 执行，以 (event_id, system, resource) 为幂等键
  ▼
证据：每个 action 一条记录  { before, after, rule_version, actor, ticket_id }
```

逐点说明机制：

- ① landing 表只追加、不覆盖。用"最新状态覆盖"的表做源头，事件重放就变成不可逆操作——同一批数据跑第二次会把已撤销的权限又加回来。
- ② `effective_date` 与 `received_at` 必须分开。预入职账号可以提前 7 天创建，但 `active` 要等到 `effective_date` 当天 00:00；离职同理，取 `last_working_day` 的次日零点。把两者混成一个字段，提前建号就等于提前放权。
- ③ 期望集合要**算**，不能"上次状态 + 增量"。这是四个断点里三个的根因：一旦以历史状态为基线，只有"加"这一种操作有事件来源，"减"永远缺少触发者。
- ④ diff 必须双向。只做 `expected − actual` 的实现，跑两年之后权限集就是历史并集的全集，且日志里全是 success。
- ⑤ 幂等键要含 `system`：同一次离职事件要作用在 IdP、HR 系统、VPN、代码托管多处，缺了这一维，第二处会被当成重复事件跳过。

## 断点一：入职——建档与授权必须分开

机制上这是两步：**建档**（provisioning，在 IdP 里创建主体、分配唯一标识）与**授权**（entitlement grant，把主体加进组或角色）。很多实现把它们合并成一个"开通"动作，结果是所有新账号天生带一批默认权限，而默认权限没有人负责解释它从哪来。

正确的顺序是先建主体、后算权限，且权限只能来自 `job_code → role_code` 的映射表。映射表要版本化，因为半年后有人问"这个人为什有防火墙权限"，答案是"当时的映射表这么写的"，而不是某个人的记忆。

可执行的检查：抽最近 30 天创建的账号，列出权限里没有 `grant_source` 的记录；每一条都要能追到工单号，追不到的就是漂移。

```sql
-- accounts / grants 是身份治理侧的视图，grants.grant_source 形如 'role:SECOPS_L2' 或 'ticket:OPS-3311'
SELECT a.uid,
       count(g.id)                                        AS grants_total,
       count(*) FILTER (WHERE g.grant_source IS NULL)     AS grants_no_source,
       min(g.granted_at)                                  AS first_grant
FROM accounts a
LEFT JOIN grants g ON g.uid = a.uid
WHERE a.created_at > now() - interval '30 days'
GROUP BY a.uid
HAVING count(*) FILTER (WHERE g.grant_source IS NULL) > 0
ORDER BY grants_no_source DESC;
```

## 断点二：转岗——增量只加不减

转岗事件在多数实现里被写成"申请新权限"，于是新部门的权限加了，旧部门的一个没删。原因不是疏忽，是模型错了：把权限当成了"人的属性"（加一次就永久属于他），而它应该是"组织位置的计算结果"（位置变了结果就变）。

修法只有一条：转岗触发**权限集重算 + 双向 diff**，而不是"批准新增权限"。重算的输入是 `dept_id`、`job_code`、`location`，不读历史授权。

目录侧还有一个字段陷阱：AD（Active Directory，微软目录服务）的 `memberOf` 是构造属性（constructed attribute），由 `primaryGroupID` 与 `tokenGroups` 实时算出，**不能直接写**。清理残留要走"从组里删成员"，删的是组的 `member` 属性，不是用户的 `memberOf`。批量脚本里对 `memberOf` 做 `REPLACE` 会返回 `unwillingToPerform`（错误码 53），看起来像权限不足，实际是语法方向错了。

可执行的检查：对所有转岗满 30 天的人，比对 `memberOf` 与期望集合，输出差集非空的行。

```bash
# 单人多组：ldapsearch 拿实际集合，与期望集合做差（OpenLDAP 用 groupOfNames，AD 用 memberOf）
ldapsearch -LLL -H ldaps://idp.example.internal -D "cn=svc-report,ou=service,dc=example,dc=internal" \
  -W -b "ou=people,dc=example,dc=internal" \
  "(employeeNumber=EMP1042)" memberOf | sed -n 's/^memberOf: cn=\(.*\),ou=groups.*/\1/p' | sort

# 期望集合由映射表算出（这里用静态表代替 rules@vN 的求值）
printf '%s\n' app-jump app-siem-read app-ticket app-cdn-console | sort > /tmp/expected.txt
comm -23 /tmp/actual.txt /tmp/expected.txt   # 只在实际集合里的 = 应撤销
comm -13 /tmp/actual.txt /tmp/expected.txt   # 只在期望集合里的 = 应授予
```

## 断点三：长期未用——判据不是"没登录"

dormant（长期未用）账号的判据不是"没登录过"，而是"在窗口期内没有任何成功的认证事件"。这句话绕，是因为 `last_login` 类字段几乎都不能直接当判据：

- AD 的 `lastLogonTimestamp` 复制间隔默认 14 天（`msDS-LogonTimeSyncInterval`，单位天，最小值受站点复制计划约束），精度不足以判断 90 天；`lastLogon` 每台域控各存一份、不复制，读到的是"这台 DC 看到的最后一次"。
- 走 SSO 的应用侧看不到登录：用户对 IdP 认证一次，之后是靠会话与刷新令牌续期，应用只在第一次拿到断言。
- 服务账号、机器账号本来就不交互登录，用"未登录"判定会把它们全判成 dormant。

阈值按账号类别分开：特权账号 30 天、普通交互账号 90 天、服务／机器账号不适用（改看凭据轮换周期与 owner 是否在职）。动作顺序是先禁用、再评估、最后删除，禁用与删除之间留 90 天，因为审计需要一个还能查的主体。

```powershell
# 90 天无交互登录、仍启用的个人账号；LastLogonTimestamp 是 FILETIME（1601-01-01 起的 100ns 计数），
# 必须换算成时间再比较，直接拿日期字符串比对会得到全量结果。
$cut = (Get-Date).AddDays(-90).ToFileTimeUtc()
Get-ADUser -Filter { Enabled -eq $true -and LastLogonTimestamp -lt $cut } `
           -Properties LastLogonTimestamp, whenCreated, Description |
  Where-Object { $_.SamAccountName -notmatch '^(svc|app|srv)-' } |
  Select-Object SamAccountName,
                @{n='LastLogon'; e={[datetime]::FromFileTime($_.LastLogonTimestamp)}},
                whenCreated, Description
```

`-lt $cut` 里 `LastLogonTimestamp` 是 64 位整数，`$cut` 也必须是整数；写成 `"2026-08-17"` 会抛类型转换错误，或者被字符串比较静默放过。

## 断点四：离职——访问面比账号大

账号只是入口之一。离职回收要覆盖的对象至少这些：IdP 主体 `active`、目录组关系、SSO 会话、OAuth 刷新令牌（refresh token）、API key、客户端凭据（client secret）、VPN 客户端证书、共享邮箱与邮件别名、外部协作邀请、凭据库（vault）里的引用、以及打印／门禁这类物理身份。

时间窗有硬约束。Kerberos 的 TGT（Ticket Granting Ticket，票据授予票据）默认最长 10 小时（`MaxTicketAge`）、可续期 7 天（`MaxRenewAge`），禁用账号只能阻止签发新 TGT，已在手的 TGT 在续期窗口内仍可使用；OIDC（OpenID Connect，基于 OAuth 2.0 的身份层协议）的 access token 是无状态 JWT（JSON Web Token），校验方只看签名与 `exp`，签发后无法逐个撤销。所以离职回收的实际策略是：短 TTL（15 分钟）＋ 反向通道登出（back-channel logout）＋ 端点侧吊销刷新令牌，三者都要，只做其中一项都会留下可用窗口。

可执行的检查：以"人"为维度导出一张访问面清单，每项必须有 `last_used` 与 `revoked_at`；离职当日 4 小时内应完成 90% 以上，剩余未完成项以工单持有并在次日复核。

## 真实请求：一次停用的 SCIM PATCH

```http
PATCH /scim/v2/Users/9c1e7a44-2f81-4d0b-9b3e-71a0c4d5e6f2 HTTP/1.1
Host: idp.example.internal
Authorization: Bearer <token>
Content-Type: application/scim+json
If-Match: W/"3"

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "replace", "path": "active", "value": false },
    { "op": "remove", "path": "members[value eq \"c1f0a2b3-8d4e-49a1-b7c2-0e5f6a7b8c9d\"]" }
  ]
}
```

逐行读：

- `PATCH` 而不是 `DELETE`：RFC 7644 里 `DELETE` 是物理删除，返回 204 之后主体就没了，`meta.created`、历史组关系、审计关联都跟着断。停用是 `replace active=false`，资源保留。
- `If-Match: W/"3"` 是 ETag 条件请求。多人同时改同一账号时，版本对不上返回 412，而不是后写覆盖。治理脚本经常省略它，结果是"刚被手工禁用的人又被脚本启用"。
- `path: "members[...]"` 里的值必须带双引号，这是 SCIM filter 语法（RFC 7644 §3.5.2）。去掉引号返回 400 `invalidPath`。
- `op` 只有 `add`／`remove`／`replace` 三个值，"清空所有组"要用 `remove path=members`（不带 filter），不能写 `replace value=[]`——不同厂商实现对此的容忍度不一样。
- 响应 200 会带回新的 `meta.version`（示例里 `W/"3"` 变成 `W/"4"`），下一步操作必须用它做 `If-Match`，否则又是一次覆盖。

## 一次同步任务的日志

```text
2026-11-15T09:00:03+08:00 lifecycle[812] event=evt_7f31 type=leaver employee=EMP1042 effective=2026-11-15 rule=rules@v14
2026-11-15T09:00:03+08:00 lifecycle[812] event=evt_7f31 expected_roles=0 actual_roles=6 remove=6 add=0 dry_run=false
2026-11-15T09:00:04+08:00 lifecycle[812] event=evt_7f31 target=idp scim_patch active=false status=200 etag="W/\"4\""
2026-11-15T09:00:04+08:00 lifecycle[812] event=evt_7f31 target=vpn revoke_cert serial=4A:19:0C status=200
2026-11-15T09:00:05+08:00 lifecycle[812] event=evt_7f31 target=crm adapter=local_db reason=no_api left=2 ticket=OPS-3311
2026-11-15T09:00:06+08:00 lifecycle[812] event=evt_7f31 done ok=4 pending=2 elapsed=3.1s
```

- 第一行带 `rule=rules@v14`：规则版本必须落进日志。规则改了但日志只有结果时，事后无法还原"当时为什么这么算"。
- 第二行 `expected_roles=0 actual_roles=6 remove=6 add=0` 是这次操作的核心证据：期望 0、实际 6、差集 6，三个数字能互相验算。少了 `expected` 这一项，`remove=6` 就无法判断是"该删的 6 个"还是"多删的 6 个"。
- 第三行到第四行是不同 target 的同一次事件：`etag` 回写说明服务端接受了变更，`revoke_cert` 是证书吊销，两者不是同一个动作，各自要留一条。
- 第五行 `reason=no_api left=2`：没有接口的应用不能静默跳过，必须落成 `left` 计数与工单号。这是"自动化覆盖率"的唯一可信来源。
- 第六行 `ok=4 pending=2`：`pending > 0` 不能记 success。告警规则应写成 `pending>0` 即报，否则这个任务永远绿灯，而残留权限一直在。

## 反例：离职账号被重建，审计指向另一个人

把离职做成 `DELETE` 的实现，通常在半年内撞上另一件事：新员工入职，命名规则是 `首字母+姓`，于是 `zhangsan` 被复用；LDAP 里 `uidNumber` 若按"当前最大值 +1"分配，也可能回到刚删掉的那个值。

第二次走一遍时序就看出问题：审计日志里的主体字段是 `uid=zhangsan` 这种字符串，两次任职共用同一个字符串，日志里 `2026-03` 的删除操作和 `2026-09` 的配置变更就分不清是谁干的。修法不是改日志，是改主体模型：

```text
不允许复用：uidNumber 只增不减（用一个只追加的分配表）
不物理删除：离职 → active=false + accountExpires=<last_working_day 次日>，
            90 天后移入 ou=leavers 并清空组关系
主体标识用不可变字段：objectGUID／sub（OIDC 的 subject），不用登录名
```

`accountExpires` 是 FILETIME，取值 `0` 与 `9223372036854775807`（0x7FFFFFFFFFFFFFFF）都表示"永不过期"，写错成 `0` 会让账号永远有效，这是目录侧最常见的一处静默失败。

## 四个技术性误解

1. **停用账号等于断开访问。** 停用阻止的是新的认证；已建立的 TCP 会话、已签发的 TGT、未过期的 refresh token 都不受影响。要断会话得按 `session_id` 杀进程或调用应用的会话吊销接口。
2. **统一了 SSO 就统一了回收。** SSO 只覆盖"登录那一刻"。应用自己的 `user` 表、本地 `status` 字段、自建 token 不在 SSO 视野里，IdP 里 `active=false` 之后它照样放行。
3. **`last_login` 能代表没在用。** 复制间隔 14 天、SSO 静默刷新、非交互的服务账号，三个原因各自都能让这个字段失真，叠加之后误判率没有上限。
4. **转岗发一次新权限就够了。** 加法有事件来源，减法没有；不重算就永远留着旧部门的权限，而且日志里每一步都是 success。
5. **删除比禁用干净。** 删除丢掉的是审计主体，留下的是悬空引用（组里的 SID、工单里的 uid），后续重建还会撞上标识复用。

## 边界条件

- HRIS 不是唯一权威源：外包、实习、供应商、共享账号通常不在其中，需要第二来源（合同系统、门禁、资产台账），并明确冲突时的仲裁顺序——写了"以 HR 为准"但 HR 里根本没有这条记录时，流程会卡死在人工判断上。
- 阈值不能统一：特权账号 30 天、普通账号 90 天、服务账号不适用。统一成一个数，要么误伤服务账号导致业务中断，要么放过特权账号。
- 没有 SCIM 也没有 LDAP 的应用只能人工，人工部分必须落 `pending` 并抽检；把它当成已覆盖，覆盖率就是假的。
- `effective_date` 的时区要固定：跨时区团队按 UTC 解释，"离职次日零点"会差出一天。

## 小结

- 权威源只描述人，权限必须由 `dept_id`／`job_code` 用带版本的规则算出来，不能"上次状态 + 增量"。
- 转岗、长期未用、离职三个断点都是减法，实现上只有一条路：重算期望集合，双向 diff，差集落证据。
- 自动化覆盖不到的部分要显式记 `pending` 并告警，`pending>0` 的 success 是假的。
