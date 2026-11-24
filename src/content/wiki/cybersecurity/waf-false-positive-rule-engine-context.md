---
title: WAF 为什么总在误报：规则、引擎与业务语境的错位
description: 一条 union select 搜索词被 403 的全过程：解析切法、归一化粒度、打分阈值与豁免作用域四处错位，附 ModSecurity 配置、审计日志逐行读与 Python/Go 片段。
createdAt: '2026-11-24'
updatedAt: '2026-11-24'
tags: [WAF, ModSecurity, 误报治理, OWASP CRS]
isPinned: false
growthStage: seedling
---

## 一句话定义

WAF（Web Application Firewall，Web 应用防火墙）把每个 HTTP（HyperText Transfer Protocol，超文本传输协议）请求拆成可匹配的片段——请求行、请求头、参数名、参数值、Cookie、JSON（JavaScript Object Notation，键值文本格式）字段——再拿规则比对已知攻击特征。误报通常不出在规则写错，而在引擎只看得见字符串，看不见这个字符串在业务里是数据还是代码。

## 组成与角色

| 层 | 承载物 | 判断依据 | 典型错位 |
|---|---|---|---|
| 解析层 | Content-Type、charset、boundary | 把 body 切成"参数名 → 值" | 切法与后端不同：`a.b`、`a[]`、重复键 |
| 归一化层 | 解码、大小写、注释剥离 | 把变形还原成特征 | 解一次还是两次 |
| 规则集 | OWASP CRS（Core Rule Set，核心规则集） | 变量 + 操作符 + 转换函数 | 判"像攻击"，不是"是攻击" |
| 打分引擎 | criticality（严重度 2-5）累加 | 总分过阈值才拦 | 几条轻命中凑成一次拦截 |
| 处置层 | deny / pass / 挑战 / 仅记录 | 拦还是放 | 检测期与拦截期不一致 |
| 业务语境 | 富文本、代码块、搜索词 | 这个值"本该"长什么样 | 这份"本该"没人维护 |

最弱的一行是业务语境：规则集通用、业务具体，中间没有机制保证一致，只能靠人写豁免。

## 一次请求穿过 WAF 的顺序

```
client → WAF（反向代理）
① 按 Content-Type 选解析器：表单按 & 切，multipart 按 boundary 分段，
   JSON 按键路径（data.items[3].title）
② 归一化：URL 解码 → 去 SQL 注释 → 折叠空白 → 转小写
③ phase 1：匹配请求行与请求头（REQUEST_LINE、REQUEST_HEADERS）
④ phase 2：匹配 body 参数（ARGS、ARGS_POST、FILES）
⑤ 打分：每条命中按 criticality 加 2/3/4/5 进 INBOUND_ANOMALY_SCORE
⑥ 判阈值：默认 ≥ 5 拦截（PL1 档），3-4 分只记日志
⑦ 处置：deny 403 并写审计日志，或 pass 但仍记录
```

③ 与 ④ 之间不可逆：body 超过内存上限就落临时文件，重组上限之外的字节不参与匹配，规则再密也不会被判。

## 关键机制

**1. 解析不一致是误报第一来源。** 同一个 `id=1&id=2`，PHP 取最后一个，WAF 可能取第一个；`id[]=1` 在后端是数组，在 WAF 眼里是名字带括号的标量；`a;b=3` 的分号，PHP 默认 `arg_separator.input` 不含，某些框架含。名字对不上，按参数名的豁免整体落空。

**2. 归一化做多做少都出事。** `t:urlDecodeUni` 会把 `%u0027` 还原成单引号；双编码 `%2527` 只解一次得到 `%27`，规则看到百分号而非引号，这是漏报方向。反过来，Markdown 的 `---` 分隔行、代码块里的 `union`，剥注释拼空白后拼成特征串，就是误报方向。

**3. 打分让误报变成组合问题。** CRS 默认 `inbound_anomaly_score_threshold=5`，单条 942100（SQLi，criticality 5）一次就够；更常见的是 920xxx 协议校验（3 分）叠一条低分规则。调优先看日志里总分的构成，不是先删规则。

**4. paranoia level 是覆盖面开关。** PL（Paranoia Level，偏执等级）1 只放最确定的规则，2-4 逐档加宽。业务含代码编辑器、工单富文本时，PL3/4 误报是常态；可行做法按 URI 分组设 PL，CRS 用 900000 系列规则按路径改 `tx.executing_paranoia_level`。

**5. 豁免的作用域决定残余风险。** `SecRuleRemoveById 942100` 是全局删规则；`ctl:ruleRemoveTargetById=942100;ARGS:content` 只去掉一个参数目标。前者一行换全站清静，代价是换个参数名就绕过。

## 真实配置与日志逐行读

ModSecurity 嵌 nginx 的惯用骨架（CRS 3.3.x）：

```apache
SecRuleEngine On                     # On / DetectionOnly / Off
SecRequestBodyAccess On              # 不开，phase 2 读不到任何参数
SecRequestBodyInMemoryLimit 131072   # 128 KB，超出部分落临时文件
SecRequestBodyNoFilesLimit 1048576   # 1 MB，非文件参数总量上限
SecResponseBodyAccess Off            # 响应体默认不扫，泄露类规则不生效
Include /etc/modsecurity/crs/crs-setup.conf   # 内含 SecAction 设阈值 5
Include /etc/modsecurity/crs/rules/*.conf     # 949110 按总分执行 deny
```

两个上限分工不同：`SecRequestBodyNoFilesLimit` 管参数总量，`SecRequestBodyInMemoryLimit` 管留在内存里的部分，只调大前者，结果是请求能进规则但多走一次磁盘。

审计日志摘录（H 段，字段按 ModSecurity 格式）：

```
[id "942100"] [msg "SQL Injection Attack Detected via libinjection"]
[data "Matched Data: union select found within ARGS:q: union select 索引"]
[severity "CRITICAL"] [ver "OWASP_CRS/3.3.7"]
[id "949110"] [msg "Inbound Anomaly Score Exceeded (Total Score: 5)"]
Action: Intercepted (phase 2)
```

`ARGS:q` 指明命中的是查询参数 q；`Matched Data` 是原始值，能看出这是业务词而不是注入；`942100` 一条就加满 5 分；**真正执行拦截的是 949110，942100 只负责加分**——改错规则是调优里的常见事故，关掉 949110 等于关掉整套打分。

## 第二个例子：被误伤的正常搜索

内部文档站搜索 `/api/docs/search?q=union select 索引`，用户要找的是文档里讲 SQL（Structured Query Language，结构化查询语言）的那一页。WAF 与业务看到的是同一串字符，没有字段能把"查文档"和"打数据库"分开。最小作用域豁免写在 WAF 侧：

```apache
SecRule REQUEST_URI "@beginsWith /api/docs/search" \
  "id:1001,phase:1,pass,nolog,ctl:ruleRemoveTargetById=942100;ARGS:q"
```

`ctl` 只对本次事务生效，`ruleRemoveTargetById` 只摘掉"942100 检查 ARGS:q"，942100 对请求头、Cookie 仍生效，`@beginsWith` 把路径钉死。

用 Python 复现解析差异，是判断豁免是否必要的最快办法：

```python
from urllib.parse import parse_qs, unquote

raw = "q=union%20select&id=1&id=2&a;b=3"
print(unquote(raw))              # WAF 未开参数解析时看到整串
# q=union select&id=1&id=2&a;b=3

q = parse_qs(raw, keep_blank_values=True, separator="&")
print(q["id"], q.get("a;b"))     # ['1', '2'] ['3']：重复键两条都在
```

WAF 按 `id` 单值处理、后端是数组时，同一份豁免覆盖不到第二条记录。

Go 侧把打分写成可解释的累加，日志必须打得出规则号：

```go
package waf

type Rule struct {
	ID       int // CRS 规则号，如 942100
	Severity int // criticality：2 notice / 3 warning / 4 error / 5 critical
}

// 累加不短路：要回答"为什么拦"，必须知道每条命中的贡献
func score(rules []Rule, hits map[int]bool) (total int, ids []int) {
	for _, r := range rules {
		if hits[r.ID] {
			total += r.Severity
			ids = append(ids, r.ID)
		}
	}
	return // total ≥ 5 时调用方 deny，ids 进日志
}
```

## 五个技术性误解

1. **"按 URI 加白名单就完事。"** 路径粒度开洞，换参数名或加无关参数都能穿过去；作用域应写到（URI，参数名，值来源）三段。
2. **"误报是规则写坏了。"** 打分模型下多数误报是多条低危规则叠加，看 `Total Score` 构成比盯单条规则有效。
3. **"拦截动作在命中的那条规则上。"** CRS 里 deny 由 949110 执行，改 942100 只影响加分，改 949110 影响全站。
4. **"PL 拉到 4 就更安全。"** PL 加的是特征覆盖面，同时加误伤；编码、分片、重组上限这类绕过与 PL 无关。
5. **"检测模式跑一周没拦，说明干净。"** 检测期没人读日志，那批 3-4 分、差一分到阈值的请求，就是上线后第一批 403。

## 边界条件

- **压缩与自定义协议**：gzip 请求体、二进制协议不进规则视野；`SecRequestBodyAccess Off` 时 phase 2 全空。
- **上限截断**：超内存上限落盘、超总量上限截断，超出部分不参与匹配，这是"规则没错却漏拦"的常见原因。
- **HTTP/2 与 chunked**：必须先重组完整 body 才能匹配，重组窗口外的分片不可见。
- **上传内容**：规则只看文件名与 Content-Type，文件内容靠另一套扫描。
- **语义边界**：WAF 只保证"匹配到已知特征的不通过"，不能保证参数被业务正确使用；豁免清单没人维护会越调越松。

## 小结

- 误报来自三处错位：解析切法、归一化粒度、规则不知道业务语义。
- 调优顺序是"看分数构成 → 缩小 target 作用域 → 再动 PL"，删规则是最后一步。
- deny 由 949110 执行，942100 只负责加 5 分。
