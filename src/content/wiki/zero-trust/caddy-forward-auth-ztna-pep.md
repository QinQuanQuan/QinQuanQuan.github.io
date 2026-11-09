---
title: 用 Caddy forward_auth 复刻零信任 PEP：决策日志该记哪几个字段
description: 从 Caddy forward_auth 与 30 行 Python PDP 入手，讲清零信任 PEP 的执行位置，以及决策日志必须记录的十一个字段和三个排障用法。
createdAt: '2026-11-09'
updatedAt: '2026-11-09'
tags: [零信任, ZTNA, 访问控制]
isPinned: false
growthStage: seedling
category: zero-trust
slug: caddy-forward-auth-ztna-pep
---

## 问题不在拦不住，在说不清

零信任上线后，第一周常被两类工单淹没：一类是「我明明有权限，为什么打不开」，另一类是「为什么他能进我不能」。如果网关只记 allow 和 deny，你只能重启、加白、道歉。零信任的可运营性取决于决策日志能否回答三个问题：谁、访问什么、被哪条策略因为什么拦住。

## 三个角色，一条链路

NIST SP 800-207 的模型里，PDP 算策略，PEP 执行策略，PIP 提供输入，包括身份、设备姿态、时间和情报。一次请求的顺序是：客户端先连 PEP；PEP 把主体、设备和目标资源送给 PDP；PDP 拉取 PIP 的输入做判断；PEP 拿到 allow 才建立到应用的连接，拿到 deny 直接返回错误码。

和 VPN 的差别不在加密算法，在判断时机。VPN 先建隧道再查 ACL，依据是「你拿到了哪个内网地址」；零信任先判断再建连接，依据是「你是谁、设备什么状态、要访问哪个应用」。

## 三十行做一个能跑的最小实现

用 Caddy 的 forward_auth 当 PEP，Python 标准库写 PDP。Caddyfile 的关键是 route：它强制指令按书写顺序执行，否则 rewrite 会抢在 forward_auth 前面，把原始 URI 改成根路径。

```caddy
{
    admin off
    auto_https off
}

:18080 {
    handle /app/* {
        route {
            forward_auth localhost:18081 {
                uri /auth
                copy_headers X-User
            }
            rewrite * /
            reverse_proxy localhost:18082
        }
    }
    respond "not found" 404
}
```

PDP 的核心只有一段 if 和 elif：没有身份返回 401；姿态不合规返回 403；应用不在该用户的允许列表返回 403；否则返回 200 并回写 X-User。每次判断都追加一行 JSON 到 decisions.jsonl，决策后、返回前写日志，拒绝也留痕。

## 日志字段：十一个就够用

ts、request_id、subject、device、posture、resource、method、decision、policy_id、reason、latency_ms。

subject 和 device 必须分开记。同一个人换设备，是零信任里最值得看的信号：如果是他自己注册的新机，可能是正常换机；如果不是，就是凭据泄露后的横向尝试。

posture 记录原始值而不是布尔值。写 posture=false，你不知道是补丁缺失还是磁盘没加密；写 posture=os_patch_missing，策略该怎么调一目了然。

policy_id 和 reason 是排障的两条腿。policy_id 定位规则，reason 面向业务解释。只有 decision 的日志，在复盘会上没有任何说服力。

latency_ms 决定策略能活多久。决策链路超过 50 毫秒用户能感知，超过 200 毫秒业务就会要求你关掉检查。

## 三个用日志直接回答的问题

```bash
python3 - <<'PY'
import json, collections
rows = [json.loads(l) for l in open("decisions.jsonl", encoding="utf-8")]
print(collections.Counter(r["reason"] for r in rows).most_common(5))
print(collections.Counter(r["policy_id"] for r in rows if r["decision"] == "deny"))
print(sum(1 for r in rows if r["subject"] is None))
PY
```

第一行回答「现在最常拦的原因是什么」，第二行回答「哪条策略在制造工单」，第三行回答「入口上每天有多少匿名探测」。这三个数字可以直接进月报，也可以直接变成策略优化的输入。每周把这三种计数各存一份，调整前后对比即可。

## 踩过的三个坑

第一，token 透传。forward_auth 只做判定，原始请求头仍会转发给应用，必须在 reverse_proxy 里用 header_up -X-Auth-Token 去掉，否则业务侧日志里全是明文凭据。

第二，指令顺序。前面说的 route 就是这个坑。第一次跑时四个请求全部 403，日志里 resource 全是根路径，看起来像策略写错，其实是 URI 被 rewrite 提前改掉了。

第三，探针被拦。健康检查没有 token，会被判 401，负载均衡于是把节点摘掉。给 /healthz 单独一个不挂 forward_auth 的 handle，或者用来源白名单放行，但一定要上线前测。

## 结论

零信任项目失败，很少是因为加密不够强，多数是因为策略没人维护、拦截无法解释。先把决策日志的字段定下来，再谈策略数量和产品选型。日志能回答「谁被哪条规则因为什么拦住」，这套东西才可能活下去。
