---
title: 最小权限的三种落地方式：RBAC、ABAC 与策略即代码
description: RBAC 用角色收敛权限点，ABAC 把判定推到请求时刻，策略即代码让判定可测试、可版本化、可复算。给出三者的角色分工、Python 与 Go 求值实现、Rego 策略与决策日志逐行读，以及各自的失效边界。
createdAt: '2026-11-18'
updatedAt: '2026-11-18'
tags: [访问控制, 最小权限, OPA, RBAC]
isPinned: false
growthStage: seedling
---

## 一句话定义

最小权限（least privilege）不是"把权限调小"，而是**每次访问都重新算一次"这一次该给多少"**的能力。RBAC（Role-Based Access Control，基于角色的访问控制）把这个计算提前固化成角色与绑定；ABAC（Attribute-Based Access Control，基于属性的访问控制）把它展开成属性表达式，在请求到达时求值；策略即代码（policy as code）把这段求值逻辑从代码里搬出来，变成可版本化、可测试、可复算的独立产物。三者不是替代关系，是同一条判定链上"决定放在哪一层、什么时候算"的三种选择。

判断一个系统有没有真做最小权限，不看权限清单有多短，看两件事：一次拒绝能不能说清是哪条规则拒的；一次授权变更之后，旧权限能不能自己消失。

## 组成与角色

任何一套访问控制都能拆成同样的五个位置。三种模型的差别，全在这五格里放了什么。

| 位置 | 承载物 | RBAC 里是什么 | ABAC 里是什么 | 策略即代码里是什么 |
|---|---|---|---|---|
| 主体 subject | 请求发起者 | `user:u1001`、`group:sec-ops`、`sa:ns:default:app` | 主体属性：`dept`、`clearance`、`groups`、`mfa` | `input.subject.*`，由 PEP 组装后传入 |
| 资源 resource | 被访问对象 | 资源类型 + 命名空间，如 `pods`@`app` | 资源属性：`owner`、`sensitivity`（1–4）、`namespace` | `input.resource.*` |
| 动作 action | 动词 | `verbs`：`get`/`list`/`watch`/`create`/`delete` | `read`/`write`/`export` 等业务动词 | `input.action.verb` |
| 上下文 context | 环境条件 | 基本缺失（最多靠命名空间近似） | `zone`、`time`、`mfa`、`risk_score` | `input.env.*`，可参与任何规则 |
| 决策点 PDP（Policy Decision Point，策略决策点） | 算放行还是拒绝 | API Server 内嵌 authorizer | 策略引擎，如 OPA（Open Policy Agent，开放策略代理） | 同一个引擎，但策略以 bundle 形式下发 |
| 执行点 PEP（Policy Enforcement Point，策略执行点） | 拦在请求路径上 | API Server 的 filter 链 | 网关 / sidecar / SDK | 网关 / sidecar，**必须覆盖所有入口** |
| 信息点 PIP（Policy Information Point，策略信息点） | 提供属性 | 无（角色即属性） | 目录服务、CMDB（Configuration Management Database，配置管理数据库）、标签服务 | 与 ABAC 共用，但要带 `ttl` 与 `version` |
| 管理点 PAP（Policy Administration Point，策略管理点） | 写策略 | `kubectl apply` 一个 RoleBinding | 策略表达式编辑器 | Git 仓库 + CI + bundle 签名 |

这张表里最容易缺的是 PIP 与 PEP 的覆盖率。RBAC 之所以落地最广，不是因为它更安全，而是因为它**不需要 PIP**——角色名本身就是属性，没有外部依赖就不会有"属性取不到"的故障模式。代价是它无法表达上下文：同一个 `viewer` 角色，从办公网和从境外 IP 访问，判定结果完全一样。

## 一次请求的求值时序

```
请求 { subject, resource, action, env }
  │ ① PEP 拦截：先鉴权后转发，未鉴权的路径不允许存在
  ▼
PEP 组装 input：主体属性从 token 解出，资源属性从资源元数据读出，env 从连接上下文取
  │ ② 属性缺失怎么办？fail-closed（缺就拒绝）还是 fail-open（缺就跳过该条件）
  ▼
PDP 求值  policy(version=v14) × input → decision
  │ ③ 求值有预算：单次 ≤ 20ms，超预算按拒绝处理
  ▼
decision { allow, policy_id, reason, input_digest, eval_ns }
  │ ④ 决策日志落盘：decision_id 用于和网关访问日志 join
  ▼
PEP 执行：allow → 转发；deny → 403 并回填 reason（对内可读，对外只回 request-id）
```

四个步骤里，真正决定"最小权限有没有生效"的是 ① 和 ④。① 漏一个入口，后面所有策略都白写——旁路不需要绕过 PDP，只要找到那个没接 PDP 的端口。④ 缺 `policy_id` 与 `input_digest`，事后就无法回答"当时为什么放行"，只能重新猜。

## RBAC：把判定收敛成"角色是否绑定"

RBAC 的判定式只有一行：`allow = (subject ∈ bindings(role)) ∧ (permission ∈ permissions(role)) ∧ (scope 匹配)`。所有复杂度都被推到了授权时：角色怎么切、权限点怎么归、绑定放在哪个 scope。

关键在于权限点的粒度。一个权限点通常是 `资源:动作` 的二元组，例如 `pods:get`、`pods/exec:create`、`secrets:list`。角色爆炸（role explosion）的成因就是这个二元组的乘积：资源类型 n 个、动作 m 个，理论权限点 n×m 个；如果再乘上"数据范围"（本部门 / 本公司 / 全量），组合数会到 n×m×k。所以 RBAC 的真实规模瓶颈不在角色数，在**是否把数据范围也编码进角色名**——一旦出现 `finance-viewer-cn-north` 这种名字，说明角色已经退化成属性组合的字符串拼接，这就是该上 ABAC 的信号。

另外两个机制必须一起上：角色继承（role hierarchy）与职责分离（Separation of Duty，SoD）。继承要做传递闭包，但**闭包必须离线算、落成物化的权限集**，不能每次请求递归查库；职责分离分静态（SSD，绑定角色时就检查互斥）与动态（DSD，同一会话内不能同时激活互斥角色）两种，只在审批环节检查而不在绑定时检查的实现，等于没有 SoD。

RBAC 的失效点很集中：**角色成为岗位的同义词**。一个叫 `ops-admin` 的角色绑了 200 多个权限点，里面既有读监控也有删库，此时"最小权限"在角色这一层已经不可判定——你只能回答"他是不是 ops-admin"，回答不了"他为什么需要删库"。治理办法不是拆权限，是回到角色定义：角色应当按**任务**切（`incident-responder`、`log-reader`），不按部门或职级切。

## ABAC：把判定推到请求时刻

ABAC 的判定式是任意布尔表达式，输入是四类属性：主体、资源、动作、环境。它解决 RBAC 解决不了的两件事：同一角色在不同上下文下权限不同；资源属性在运行时才确定（比如"只能读自己创建的对象"）。

代价是它把复杂度从授权时推到了**每一次请求**，于是引入两个新故障模式：属性源不可用、属性口径不一致。下面这段求值器把这两点写成显式分支。

```python
# abac_eval.py —— ABAC 求值器：缺属性即拒绝，超预算即拒绝
from dataclasses import dataclass
from hashlib import sha256
from time import monotonic_ns
import json

@dataclass(frozen=True)
class Decision:
    allow: bool
    policy_id: str      # 策略标识 + 版本，审计的第一字段
    reason: str         # 机器可读原因码，不写自然语言
    input_digest: str   # 求值入参的 sha256，事后可复算
    eval_ns: int

class PIP:
    """策略信息点：属性的唯一来源。每个属性带 ttl 与 version。"""
    def __init__(self, backend, ttl_s: dict[str, int]):
        self.backend = backend
        self.ttl_s = ttl_s          # {"dept": 300, "sensitivity": 60, "risk": 30}

    def get(self, kind: str, key: str):
        value = self.backend.get(kind, key)   # 返回 {"value":..., "version":...} 或 None
        if value is None:                     # 属性缺失 → KeyError，调用方 fail-closed
            raise KeyError(f"attr_missing:{kind}:{key}")
        return value["value"], value["version"]

def evaluate(subject: dict, resource: dict, action: str,
             env: dict, pip: PIP, budget_ms: int = 20) -> Decision:
    t0 = monotonic_ns()
    snapshot = {"s": subject, "r": resource, "a": action, "e": env}
    digest = sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()[:16]
    try:
        dept, _ = pip.get("dept", subject["uid"])
        owner, _ = pip.get("owner", resource["id"])
        level, _ = pip.get("sensitivity", resource["id"])   # 1=公开 2=内部 3=敏感 4=核心
    except KeyError as exc:
        # 拿不到属性时不放行：宁可 403，也不按"条件不满足即跳过"处理
        return Decision(False, "abac.core.v3", str(exc), digest, monotonic_ns() - t0)

    need_mfa = level >= 3
    allow = (
        action in {"read", "list"}
        and (dept == owner or subject.get("clearance", 0) >= level)
        and env.get("zone") in {"office", "vpn"}          # 环境属性参与判定
        and (env.get("mfa") is True or not need_mfa)
    )
    cost = monotonic_ns() - t0
    if cost > budget_ms * 1_000_000:
        return Decision(False, "abac.core.v3", "eval_budget_exceeded", digest, cost)
    return Decision(allow, "abac.core.v3",
                    "ok" if allow else "no_matching_rule", digest, cost)
```

这段代码里有三个反直觉点。第一，`clearance >= level` 用的是数值大小比较，那就必须锁死数值语义（1–4 递增，0 表示无授权），否则两套系统对"3"的理解不同，比较结果就不可信。第二，属性缺失走 `KeyError` 分支而不是"跳过该条件"——后者等于把条件删掉，是权限放大最常见的实现 bug。第三，`input_digest` 只哈希入参、不含策略版本，所以要复算必须同时拿到 `policy_id` 与入参快照，两者缺一都不能复现判定。

## RBAC 的工程实现：缓存必须带版本

RBAC 的判定本身是集合查找，问题是绑定存在数据库里，每个请求都查一次库扛不住。加缓存之后最常见的 bug 是"绑定撤了，缓存里还放着"——所以缓存键里必须放一个全局单调递增的 `version`，绑定或角色任何一次变更就 +1。

```go
// rbac_check.go —— 判定 + 版本化缓存（Go 1.22）
package authz

import (
	"context"
	"errors"
	"sync"
	"time"
)

type Binding struct {
	Subject string // "user:u1001" / "group:sec-ops" / "sa:default:app"
	Role    string // "log-reader" / "incident-responder"
	Scope   string // 命名空间或租户，"" 表示全局
}

type Store interface {
	Bindings(ctx context.Context, subject string) ([]Binding, error)
	Role(ctx context.Context, name string) (map[string]struct{}, error) // "pods:get"
	Version(ctx context.Context) (uint64, error)                        // 变更即 +1
}

type Checker struct {
	store Store
	ttl   time.Duration
	mu    sync.RWMutex
	cache map[string]entry
}

type entry struct {
	perms map[string]struct{}
	ver   uint64
	at    time.Time
}

var ErrDenied = errors.New("deny")

// Allowed 返回 (是否放行, 错误)。错误非 nil 时调用方必须按拒绝处理。
func (c *Checker) Allowed(ctx context.Context, subject, verb, resource, scope string) (bool, error) {
	perms, err := c.permSet(ctx, subject, scope)
	if err != nil {
		return false, err // 取不到绑定 → 拒绝，而不是放行
	}
	_, ok := perms[resource+":"+verb]
	return ok, nil
}

func (c *Checker) permSet(ctx context.Context, subject, scope string) (map[string]struct{}, error) {
	ver, err := c.store.Version(ctx)
	if err != nil {
		return nil, err
	}
	key := subject + "|" + scope

	c.mu.RLock()
	e, hit := c.cache[key]
	c.mu.RUnlock()
	if hit && e.ver == ver && time.Since(e.at) < c.ttl {
		return e.perms, nil // 版本一致且未过期，才复用
	}

	bindings, err := c.store.Bindings(ctx, subject)
	if err != nil {
		return nil, err
	}
	perms := make(map[string]struct{}, 32)
	for _, b := range bindings {
		if b.Scope != "" && b.Scope != scope {
			continue // 作用域不匹配的绑定不参与
		}
		rp, err := c.store.Role(ctx, b.Role)
		if err != nil {
			return nil, err // 角色被删但绑定还在：视为配置错误，拒绝
		}
		for p := range rp {
			perms[p] = struct{}{}
		}
	}

	c.mu.Lock()
	c.cache[key] = entry{perms: perms, ver: ver, at: time.Now()}
	c.mu.Unlock()
	return perms, nil
}
```

`scope` 那一行是最容易写错的地方：空字符串表示全局绑定，必须能与任何 scope 匹配，所以判断条件是 `b.Scope != "" && b.Scope != scope`。写成 `b.Scope != scope` 会让全局角色在业务命名空间里全部失效，表现是"明明绑了却没权限"，而错误日志里只有 deny，没有原因。

## 策略即代码：判定逻辑离开代码库

把上面两段判定式从应用代码里搬出来，用专用语言（OPA 用 Rego，语法是声明式的）写，好处不是"配置化"，而是三件具体的事：策略有单独版本、策略可以在 CI 里跑单元测试、每次判定留下可复算的决策日志。

```rego
package authz

import rego.v1                      # 启用 v1 语法（OPA 1.x 默认）

default allow := false              # 默认拒绝：未命中的路径全部落到 false

allow if {                          # 任一 allow 规则成立即放行
	input.action.verb == "get"
	input.resource.kind == "pods"
	input.subject.groups[_] == "sec-ops"
	input.subject.mfa == true
	not input.resource.namespace == "kube-system"   # 排除系统命名空间
}
```

逐行读：

- `default allow := false` 决定兜底语义。没有它，`allow` 在无规则命中时是 undefined（未定义），不同 SDK 对 undefined 的处理不一致，网关可能当成"没有决策"而放行。
- `input` 是 PEP 传入的整个请求对象，`data` 才是策略侧的数据（角色表、标签）。把两者混用会导致策略随请求变化，无法测试。
- `input.subject.groups[_]` 是对数组做存在性遍历，意思是"组里任意一个等于 `sec-ops` 即可"。写成 `== ["sec-ops"]` 就变成"组列表恰好只有 sec-ops"，语义完全不同。
- `not input.resource.namespace == "kube-system"` 是排除条件。`not` 修饰的是整个表达式，所以 `not a == b` 与 `a != b` 在字段缺失时行为不同：前者在字段缺失时也可能成立。
- 规则里没有写"允许的具体动作列表"，只有 `verb == "get"`。这意味着 `list`、`watch` 都要单独写一条——这正是最小权限该有的默认方向。

判定结果落成一行决策日志：

```json
{"decision_id":"9a1c7e04","path":"authz/allow","result":false,
 "input":{"action":{"verb":"get"},"resource":{"kind":"pods","namespace":"kube-system"},
          "subject":{"groups":["sec-ops"],"mfa":true}},
 "metrics":{"timer_rego_query_eval_ns":82314},
 "bundles":{"authz":{"revision":"v14"}},"labels":{"env":"prod"}}
```

`decision_id` 用来和网关访问日志做 join；`result` 是布尔值（不是"deny 字符串"）；`timer_rego_query_eval_ns` 是本次求值耗时，单位纳秒，82314 约等于 82 微秒，超过 20 毫秒就要怀疑策略里有正则或大数组遍历；`bundles.authz.revision` 是策略版本号，**这一项加 `input` 才是可复算的完整证据**。缺 revision 时，你只能知道"被拒了"，无法知道"被哪一版策略拒的"。

策略下发靠 bundle：引擎定期轮询拉取，OPA 的轮询参数是 `bundles.<name>.polling.min_delay_seconds` 与 `max_delay_seconds`，默认分别是 60 与 120 秒。这就是策略生效的延迟上界——改一条策略到全集群生效，最长要等两分钟。紧急封禁不能依赖这条路，得另外有推送通道或直接在 PEP 上做临时拒绝。

## 反例：一行 RBAC 规则把只读升级成命令执行

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: developer
  namespace: app
rules:
- apiGroups: [""]
  resources: ["pods", "pods/log"]     # 本意：排障时看日志
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["pods/exec"]            # 这一行等价于"在容器里执行任意命令"
  verbs: ["create"]
```

`pods/exec` 的 `create` 对应 `POST /api/v1/namespaces/app/pods/<name>/exec`，语义是开一个进程进去。一旦进去，容器内可读的 ServiceAccount（服务账号）令牌、环境变量、挂载的 Secret 都在射程内——如果该账号对 `secrets` 有 `get`，这条规则实际授予的是命名空间内的凭据访问。所以"给开发看日志"的需求必须拆成 `pods/log` 只读，`pods/exec` 单独走审批，且**不要指望 RBAC 自动过期**：Role、RoleBinding 都没有 `expiresAt` 字段，临时授权只能靠外部流程建了再删（或在 Operator 里加 TTL 回收）。类似的高危动词还有 `escalate`（改角色）与 `bind`（绑角色），持有它们等于能给自己加任意权限。

## 四个技术性误解

1. **"最小权限就是把权限调小。"** 可度量的指标是三个：权限点总数、人均未使用权限数、拒绝率。前两个降不下来，说明角色按岗位切了；第三个接近零，说明策略根本没生效。
2. **"RBAC 和 ABAC 是并列的两种技术。"** 角色本身就是主体属性，所以 RBAC 是 ABAC 在"只用一个属性、且在授权时求值"的特例。选型的实质是：属性维度是否超过一维，资源属性是否在运行时才确定。
3. **"策略即代码就是把 YAML 放进 Git。"** 差别在可判定性：能不能在 CI 里对策略跑用例（`opa test`）、能不能按 revision 灰度、能不能用决策日志复算历史判定。只有版本管理而没有测试，等于把配置漂移搬到了 Git。
4. **"默认拒绝总是更安全。"** 默认拒绝加上属性源故障，结果是一次 PIP 抖动全站 403。安全做法是把 fail-closed 用在**授权**上、把可用性兜底放在**降级路径**上，并给 break-glass（应急放行）单独的高强度审计，而不是悄悄改成 fail-open。

## 边界条件

- **令牌里的属性会过期不一致。** 组信息写在 JWT（JSON Web Token，一种带签名的令牌）的 claim 里，`exp` 未到就继续有效；撤组之后，最长会有一个令牌生命周期的窗口仍然放行。要么把 `exp` 压到分钟级，要么在 PEP 侧对高风险动作强制回查 PIP。
- **非人类主体建模不了。** 定时任务、批处理、CI 机器人没有部门与职级，用 `dept` 类属性判定会直接落到拒绝分支。这类主体应该单独一类策略，按"调用方 + 目标资源 + 时间窗"判定，而不是硬套人的属性。
- **规模有非线性。** 策略条数增长时，含 `some`、`every`、正则的规则求值成本上升最快；把高频判定拆成独立的 `package`，并给每次求值设预算，比事后优化更有效。
- **PEP 覆盖率决定上限。** 三个入口接了两个，第三个就是全部策略的旁路。上线前先枚举入口清单（网关、sidecar、管理端口、调试端口），逐个确认走 PDP，再谈策略写得对不对。

## 小结

RBAC 用角色把权限点收敛，代价是丢掉上下文；ABAC 把判定推到请求时刻，代价是依赖属性源与求值预算；策略即代码让判定可测试、可版本化、可复算，代价是多了一条下发链路和两分钟量级的生效延迟。
三者的共同前提是同一个：PEP 必须覆盖所有入口，否则模型再精细也只是写在纸上的约束。
