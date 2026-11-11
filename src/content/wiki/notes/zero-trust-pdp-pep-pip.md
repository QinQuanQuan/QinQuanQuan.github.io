---
title: 零信任的决策三角：PDP、PEP、PIP 各自做什么
description: 用一次请求的时序讲清 PDP、PEP、PIP 的分工，说明 PEP 为什么必须贴着应用，并给出一段可运行的 Caddy forward_auth 加 Python PDP 配置。
createdAt: '2026-11-11'
updatedAt: '2026-11-11'
tags: [零信任, 访问控制, ZTNA]
isPinned: false
growthStage: seedling
---

零信任的文档里经常出现三个缩写：PDP、PEP、PIP。它们不是三个产品，而是一次访问决策里三个不同的职责。把职责分清，很多"零信任上线后为什么还是能被绕"的问题就能直接定位。

一句话概括：**PDP 算，PEP 拦，PIP 供料。**

## 三个角色分别是什么

| 角色 | 全称 | 职责 | 典型实现 |
|---|---|---|---|
| PDP | Policy Decision Point | 根据主体、资源、上下文算出 allow 或 deny | 策略引擎（OPA、自研决策服务） |
| PEP | Policy Enforcement Point | 挡在资源前面，执行 PDP 的结论 | 反向代理、Sidecar、客户端 agent、应用内中间件 |
| PIP | Policy Information Point | 提供判断所需的输入：身份、设备姿态、时间、情报 | IdP、EDR、CMDB、威胁情报源 |

三者失效时的表现完全不同，可以用这个特征反推是哪一环出了问题：

- 策略改了不生效、或者干脆全放行 → 先查 PDP。
- 用户绕过入口直连后端，或者某个应用没接进来 → 查 PEP 的覆盖范围。
- 决策时好时坏、离职员工还能进、设备状态明明异常却放行 → 查 PIP 的数据新鲜度。

## 一次访问的完整时序

```
客户端 ──①请求──▶ PEP ──③问──▶ PDP ──④拉上下文──▶ PIP
                    │              │
                    │◀──⑤allow/deny─┘
                    │
                    ├─allow─▶ 应用（应用端口不对外暴露）
                    └─deny──▶ 403 / 重定向到认证
                    ⑦决策日志：谁、访问什么、哪条策略、为什么
```

关键在第 ⑤ 步和第 ⑦ 步。

第 ⑤ 步要求 PDP 的返回里必须带**策略标识和原因**，不能只有一个布尔值。原因缺失的后果是可运营性崩塌：每天都会有"我明明有权限为什么打不开"的工单，而你只能重启策略、加白名单，最后退化成全员放行。

第 ⑦ 步是决策日志。一条合格的日志至少包含：时间、请求 ID、主体、设备标识、设备姿态、资源、方法、结论、策略 ID、命中原因、决策耗时。少任何一项，事后都还原不了。

## 为什么 PEP 必须贴着应用

这是零信任和传统 VPN 最实质的差别，也是面试里最容易答偏的地方。

VPN 的信任载体是网络位置：认证一次，分配一个内网 IP，之后所有访问靠这个 IP 放行。它的 PEP 在网络边界，一旦放行，内网就是可达的。所以它的安全性取决于"边界有多难破"，一旦破了一层，剩下的靠分段和运气。

ZTNA 把 PEP 挪到每个应用前面：应用端口不对内网暴露，客户端连的是边缘网关，网关通过连接器连应用。授权之后你得到的不是"一张内网通行证"，而是"一条到某个应用的连接"。

这个改动带来的差别不在认证强度，而在**授权之后能得到什么**：前者得到一片网络，后者得到一个应用。横向移动的空间就是从这一步被压缩掉的。

## 一段真实的 PEP

用 Caddy 的 `forward_auth` 做一个最小 PEP，后面挂一个二十行的 PDP。这段配置能直接说明三个角色的位置。

```caddyfile
# PEP：/app/ 的所有请求先问 PDP，拿到 2xx 才转发
app.example.com {
    forward_auth 127.0.0.1:9000 {
        uri /decide
        copy_headers X-Decision-Id X-Policy-Id
    }
    reverse_proxy 127.0.0.1:8080
}
```

Caddy 把原始请求的方法、路径、客户端 IP 和头部原样送到 `/decide`，只有返回 2xx 才继续代理。这一步就是"先决策、再建连接"。

```python
# PDP：算出结论，并把原因一起返回
@app.post("/decide")
def decide(req: Request):
    subject = req.headers.get("X-Auth-Request-User")      # 由上游 IdP 注入
    device  = req.headers.get("X-Device-Id")
    resource = req.headers.get("X-Forwarded-Uri")

    posture = pip.posture(device)          # PIP：设备是否合规
    groups  = pip.groups(subject)          # PIP：组织信息

    if posture != "compliant":
        return deny("posture_fail", "zt-001", 403)
    if "finance" not in groups:
        return deny("group_mismatch", "zt-001", 403)
    return allow("zt-001", 200)
```

三件事在这段代码里同时发生：PEP 负责把上下文送进来（否则 PDP 无从判断），PIP 提供 `posture` 和 `groups`，PDP 只做判断，不碰连接。

## 三个常见误解

**一，PEP 就是一台网关设备。** PEP 的本质是"执行点"，形态可以是反向代理、Service Mesh 的 Sidecar、应用内的中间件，甚至是数据库前面的代理。判断标准只有一个：**绕过它，能不能直接到达资源。** 能，就说明它不是一个有效的 PEP。

**二，PDP 就是策略管理界面。** 界面只负责把策略写进存储，真正做决策的是运行时的决策服务。两者分开的好处是策略可以版本化、可以灰度；坏处是很多人只改了界面，忘了决策服务有缓存。

**三，PIP 就是 CMDB。** CMDB 只提供资产归属。零信任的判断还需要设备姿态（补丁、加密、EDR 在线）、时间窗口、行为基线、威胁情报。这些数据的新鲜度直接决定决策质量：PIP 里一条三个月没更新的设备记录，会让"合规设备"这个条件形同虚设。

## 这套模型的边界

- **它主要覆盖南北向的 HTTP 访问。** 非 HTTP 协议要靠 L4 代理或客户端 agent，覆盖成本高得多。
- **它不解决东西向。** 应用之间、工作负载之间的通信要靠微隔离，两套东西解决的是不同问题。
- **PDP 会成为单点和延迟来源。** 每个请求多一次远程调用，P99 延迟和可用性必须提前算；同时要明确故障时是 fail-closed 还是 fail-open，这个选择本身就是一次风险决策。
- **决策日志有留存与合规要求。** 它包含主体、资源、时间，属于敏感数据，留存周期和访问权限要跟数据安全要求对齐。

## 小结

PDP 算，PEP 拦，PIP 供料；PEP 的位置决定授权之后能得到什么；日志里没有原因，就等于没有决策。
