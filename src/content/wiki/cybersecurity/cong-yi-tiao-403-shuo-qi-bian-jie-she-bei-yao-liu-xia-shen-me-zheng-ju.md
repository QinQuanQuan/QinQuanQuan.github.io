---
title: 从一条 403 说起：边界设备要留下什么证据
description: 一条 403 为什么查不清：五个证据坐标、request_id 全链路透传、rule_id 带 revision、拒绝事件全量记录与哈希链，附 Nginx 配置、日志逐行读和 Python/Go 片段。
createdAt: '2026-11-27'
updatedAt: '2026-11-27'
tags: [WAF, 日志审计, 可观测性]
isPinned: false
growthStage: seedling
---

## 一句话定义

边界设备的"证据"不是日志条数，而是一次拒绝能否被还原到五个坐标：谁（主体标识）、访问什么（客体定位）、被哪条策略拦（规则标识 **加版本**）、什么时候（统一时钟）、怎么拦的（动作与命中片段）。五个坐标缺一个，403 就只是一个数字，事后既不能复现也不能追责。

## 组成与角色

一条请求从公网进到业务，至少穿过四类设备，每类只掌握证据的一段：

| 环节 | 典型实现 | 能提供的字段 | 结构性缺口 |
|---|---|---|---|
| 接入层 | LVS / 云 SLB | 五元组、SNI（Server Name Indication，TLS 握手里的目标域名）、TLS 版本、客户端证书序列号 | 看不到 HTTP（HyperText Transfer Protocol）语义 |
| 七层反代 | Nginx / Envoy | request_id、host、uri、method、status、upstream_addr、request_time | 不知道是哪条策略做的决定 |
| 防护层 | Coraza / ModSecurity / 云 WAF（Web Application Firewall） | rule_id、severity、matched_var、命中片段、规则集版本 | 认不出主体是谁 |
| 鉴权层 | OIDC（OpenID Connect，基于 OAuth 2.0 的身份层）/ OPA（Open Policy Agent，策略引擎） | sub（主体标识）、iss、aud、scope、decision_id | 只覆盖已认证流量 |
| 汇集层 | Fluent Bit / Vector | 字段归一化（ECS、OCSF 两套通用字段规范）、按 id 拼接 | 丢弃、采样、乱序 |
| 留存层 | SIEM（日志汇聚与关联分析系统）/ 对象存储 | 保留期、检索、哈希链校验 | 写入有延迟 |

设备各写各的，拼不到一起就都是孤证。所以第一件事是定标识：请求号 `request_id`（网关生成，32 位十六进制）、链路号 `trace_id`（W3C Trace Context 的 `traceparent`，固定 55 字符：版本-32 位 trace id-16 位 span id-标志）、主体 `sub`、策略 `rule_id + revision`。这四个 ID 在各层原样透传，事后才有得拼。

## 一次 403 的证据流

```
t0  client → LB     记五元组 + SNI + TLS 版本
t1  LB → 网关      注入 X-Request-Id: 4f1c…（32 hex），透传 traceparent
t2  网关路由       匹配 server_name 与路由，记 route_id、upstream_addr
t3  认证           校验 JWT（JSON Web Token）的 iss/aud/exp/nbf，失败回 401
t4  鉴权           策略引擎给 decision_id + policy revision，拒绝 → 403(authz)
t5  WAF 检测       phase1 查头 / phase2 查 body，命中 → 403(waf) + rule_id
t6  响应           记 status、响应字节、request_time、upstream_response_time
t7  汇集           按 request_id 合并三段，缺段标 incomplete=true
t8  入库           哈希链 + 批次签名；热存 30 天、冷存 180 天
```

流程里最关键的一行是 t4 与 t5：两者都能返回 403，来源不同，处置动作也不同——鉴权拒绝要查账号与授权模型，WAF 拒绝要查规则与 payload。若日志里不区分，事故复盘时只能靠猜。低成本做法是响应头带 `X-Policy-Stage: authz|waf|ratelimit`，同时写进日志字段。

## 关键机制

**1. 主体不能只记 IP。** 一个出口 IP 后面可能是整栋写字楼；CGNAT（Carrier-Grade NAT，运营商级地址转换）下几千个用户共用一个地址；IPv6 按前缀 /64 分配，单个地址不代表一个人。有凭据就记 `sub`，没凭据至少记 IP + UA（User-Agent）+ TLS 指纹（JA3/JA4，按握手字段算出的客户端指纹）+ 会话 cookie 的 sha256 前 8 位，四者组合才有区分度。

**2. 客体要记到能重放定位的粒度。** `method` + `scheme://host` + `path`（不含 query 原文，参数名排序后单独记 `param_names`）+ `body_sha256` + `body_len` + `content_type`。query 里常带手机号、身份证、token，原样落盘等于把日志库变成敏感数据仓库。

**3. 策略标识必须带版本。** `rule_id` 是槽位不是内容。CRS（Core Rule Set，OWASP 核心规则集）每年多个版本，942100 在 3.3 与 4.x 的匹配逻辑、严重度都改过，同 id 的拦截在三个月后无法解释"当时匹配了什么"。要求记三元组：`rule_id` + `ruleset`（如 coraza-crs 4.3.0）+ 规则文件快照 sha256。

**4. 命中片段要留，但要截断与脱敏。** 记 `matched_var`（如 `ARGS:q`）、`matched_offset`、`matched_len`、前 64 字节转义文本。password、token、authorization、cookie 四类字段一律写 `<redacted>`，只留长度与哈希前缀——既证明命中位置，又不复制凭据。

**5. 拒绝事件不可采样。** 正常流量 1% 采样无害，deny 必须 100%。攻击请求占比常低于万分之一，1% 采样下一天 100 次攻击期望只剩 1 条，且不是随机均匀丢失。落地做法是两条日志通道：全量写 `evidence.log`（仅 4xx/5xx），采样写 `traffic.log`。

**6. 完整性靠链不靠权限。** 每条记录带 `prev_hash`，成哈希链；每小时把链头哈希与记录总数签名后写入开启 Object Lock（对象锁定）的存储桶，本地日志被删也能从"第 N 条之后断链"发现缺口。文件权限挡的是误操作，挡不住拿到 root 的攻击者。

**7. 时钟统一到 UTC。** 全链路 chrony 对时，偏移告警阈值 ±50ms；日志一律写 ISO 8601 带 Z，展示层再转 +08:00。跨设备算耗时要用单调时钟差值，不能用两台机器的墙上时间相减。

## 真实配置与日志逐行读

Nginx 侧的证据日志骨架：

```nginx
log_format evidence escape=json
  '{"ts":"$time_iso8601","rid":"$request_id",'
  '"traceparent":"$http_traceparent",'
  '"src":"$remote_addr","sport":"$remote_port",'
  '"peer":"$realip_remote_addr","xff":"$http_x_forwarded_for",'
  '"sni":"$ssl_server_name","method":"$request_method",'
  '"host":"$host","uri":"$uri",'
  '"status":$status,"req_len":$request_length,'
  '"bytes":$body_bytes_sent,"rt":$request_time,'
  '"urt":"$upstream_response_time","upstream":"$upstream_addr",'
  '"stage":"$sent_http_x_policy_stage","rule":"$sent_http_x_rule_id",'
  '"ua":"$http_user_agent"}';

access_log /var/log/nginx/evidence.log evidence buffer=64k flush=5s;
```

- `escape=json` 不是可选项。没有它，UA 里的双引号会截断 JSON，整条记录解析失败；攻击者能主动构造这种 UA，等于顺手擦掉自己的痕迹。
- `$request_id` 由 nginx 生成 32 位十六进制。若信任上游传来的 `X-Request-Id`，必须先用 map 校验 `^[0-9a-f]{32}$`，否则攻击者可以写入 8KB 垃圾串撑爆日志字段。
- `$remote_addr` 在 CDN 后面是 CDN 回源地址。要用 `set_real_ip_from <CDN 回源网段>` + `real_ip_header X-Forwarded-For` + `real_ip_recursive on` 把它还原成客户端 IP，原始对端另存 `$realip_remote_addr`，两个都记——只记一个是猜，两个都记才能验证。
- `$request_length` 是请求总字节（请求行 + 头 + body），`$body_bytes_sent` 是响应体字节，方向相反，别混。
- `$upstream_response_time` 没有回源时是 `-`，重试时是逗号分隔多值，解析按数组处理。
- `stage` 与 `rule` 由 WAF 或鉴权模块在拒绝时 `add_header` 写回。注意 `add_header` 默认只对 2xx/3xx 生效，403 场景必须显式加 `always`，否则响应头在 403 上根本不出现。

一条真实形状的记录（地址与域名用占位符替代）：

```
{"ts":"2026-11-27T14:02:11+00:00","rid":"9a3f6c1d2b8e4f70a15c3d9e6b2f8a41",
 "src":"<client-ip>","sport":"51422","peer":"<cdn-egress-ip>",
 "sni":"api.example.net","method":"POST","host":"api.example.net",
 "uri":"/v1/orders/export","status":403,"req_len":1842,"bytes":162,
 "rt":0.004,"urt":"-","upstream":"-","stage":"waf","rule":"942100"}
```

读法：`urt` 与 `upstream` 都是 `-`，说明请求没回源，在网关本地被拦；`stage=waf` 指向防护模块；`rule=942100` 是 CRS 的 SQL 注入检测规则。反过来，若这条记录的 `urt` 是 `0.031`、`upstream` 是 `order-svc:8080`，403 就来自业务代码，算进 WAF 拦截率会让月报整体虚高。

## 把一次拒绝落成记录

Python 侧做哈希链，一条记录自带前驱哈希：

```python
import hashlib, json, time

def seal(event: dict, prev_hash: str) -> tuple[str, str]:
    """返回 (可投递的 JSON 字符串, 本条哈希)。event 必须含 policy.revision。"""
    rec = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rid": event["rid"],                    # 32 hex，全链路唯一
        "stage": event.get("stage"),            # authz / waf / ratelimit
        "subject": {"sub": event.get("sub"),    # JWT 的 sub，匿名时为 None
                     "ip": event["client_ip"],  # 已按可信代理链还原
                     "ja4": event.get("ja4")},
        "object": {"host": event["host"], "method": event["method"],
                    "path": event["path"],
                    "body_sha256": event.get("body_sha256"),
                    "body_len": event.get("body_len", 0)},
        "policy": {"rule_id": event["rule_id"],
                    "ruleset": event["ruleset"],       # 如 coraza-crs 4.3.0
                    "snapshot": event["snapshot"],     # 规则文件 sha256
                    "action": event.get("action", "deny")},
        "prev_hash": prev_hash,
    }
    blob = json.dumps(rec, sort_keys=True, separators=(",", ":"))
    rec["hash"] = hashlib.sha256(blob.encode()).hexdigest()
    return json.dumps(rec, ensure_ascii=False), rec["hash"]
```

`sort_keys=True` 与固定分隔符是为了让哈希可复算：换一个序列化实现，哈希就变，链就断。`prev_hash` 参与哈希，删除中间任意一条都会让后续全部校验失败，且断点位置可知。

Go 侧在网关中间件里保证"生成 + 透传 + 拒绝必落盘"：

```go
type denyRec struct {
	RID, Stage, Host, Method, Path string
	Status                         int
	RuleID, Ruleset, Snapshot      string
	TS                             time.Time
}

func Evidence(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rid := r.Header.Get("X-Request-Id")
		if len(rid) != 32 { // 不合法就自己生成，杜绝外部注入
			rid = strings.ReplaceAll(uuid.NewString(), "-", "")
		}
		w.Header().Set("X-Request-Id", rid) // 回写给客户端，便于用户报障时提供

		rec := &denyRec{RID: rid, TS: time.Now().UTC(), Host: r.Host,
			Method: r.Method, Path: r.URL.EscapedPath()}

		sw := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(sw, r) // 业务或 WAF 在这里写 403

		if sw.status == http.StatusForbidden {
			rec.Status = sw.status
			rec.Stage, rec.RuleID = w.Header().Get("X-Policy-Stage"), w.Header().Get("X-Rule-Id")
			emit(rec) // 同步投递；失败进本地磁盘队列，不丢
		}
	})
}
```

`statusWriter` 包一层 `WriteHeader` 记状态码，否则中间件只能看到响应字节，看不到状态码。`emit` 走阻塞队列加磁盘兜底：日志后端不可用时丢的是证据，不是可选指标。

## 两个反例

**反例一：只有 rule_id 的云 WAF 日志。** 某次事后核查拿到三条字段：`rule_id=1000123`、`action=block`、`client_ip`。三个月后规则库升级，1000123 从"SQL 注入-基础特征"改成"SQL 注入-注释变体"，匹配逻辑与严重度都变了。此时历史拦截既解释不了"当时匹配到什么"，也复现不了"同样的请求今天还会不会被拦"。补救只能靠规则包变更记录按日期映射版本，再用 `client_ip + path + 时间窗` 去源站 access log 里捞对应请求比对哈希——而源站压根没收到被拦的请求，这条路走不通。证据链的强度由最弱一环决定，边界设备缺字段，下游补不回来。

**反例二：全量 dump 请求原文。** 为了"以后好查"，把 `Authorization` 头、cookie、body 原文整包写进日志。结果日志平台的只读分析师账号能看到全站 token，日志库成了比业务系统更大的暴露面。证据充分与最小暴露要同时满足：字段走白名单，敏感值只留长度与哈希，正文按需在受控环境解密（若确需留存密文，密钥与日志分开存放）。这跟"少记"是两回事——记的是结构化字段，不是不记。

## 技术性误解

1. **有 access log 就等于有证据。** 状态码只回答结果。403 至少有三种来源：WAF、鉴权中间件、源站业务。不记 `stage`，接到用户报障时仍然要人工翻三处。
2. **记了 X-Forwarded-For 就有真实 IP。** 这个头客户端可写。多级代理下最左值最不可信，正确做法是从右往左跳过已知代理网段，取第一个非代理地址，并把跳过过程写进日志（`xff_chain_len`）。
3. **采样对安全分析没影响。** 采样按请求数均匀抽，而攻击是稀疏事件。1% 采样下，一天 100 次探测期望只剩 1 条，且集中在业务高峰时段的样本里攻击密度更低。
4. **rule_id 相同，规则就相同。** id 是槽位。规则库升级会改匹配表达式、变换函数、严重度。没有 `revision` 与快照哈希，历史拦截无法解释。
5. **本地审计日志够用。** 拿到主机权限后的常见动作就是清 `/var/log`。审计日志必须实时外发、远端 WORM（Write Once Read Many，一次写入不可改）存储，并用哈希链证明"没少条"。

## 边界条件

- **SNI 与 Host 不一致**（域名前置）：策略以 `Host` 为准，`SNI` 只作辅助证据，两者不一致本身就是特征信号。
- **HTTP/2 与 HTTP/3**：`:authority` 伪头取代 `Host`，头名全小写；归一化时统一映射到 `host`，否则按域名统计会漏掉一半流量。
- **body 检查上限**：Coraza 默认 `SecRequestBodyLimit` 约 12.5MB，超出部分不检查或落盘。命中记录要带 `inspected_bytes` 与 `partial=true`，否则"没拦住"会被误判成"规则没写"。
- **chunked 上传无 Content-Length**：`req_len` 只含头长度，实际 body 需要流式计数，两者差几个数量级是正常的。
- **IPv6 与 CGNAT**：五元组会复用，端口不能当会话标识，用 `trace_id` 或 cookie 哈希。
- **保留期**：网络日志保存不少于六个月是通行合规要求，冷存成本要提前算；哈希链让"到期删除"和"篡改删除"可区分——前者是断点之后无记录且总数对得上，后者是总数对不上。

## 小结

一条 403 要能回答三问：谁、访问什么、被哪条策略拦。抓手是 request_id 贯穿全链路、策略带 revision、拒绝事件全量记录、记录落在哈希链上。字段缺了事后补不回来，因为被拦的请求根本没有到达源站。
