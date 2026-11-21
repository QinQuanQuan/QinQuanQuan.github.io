---
title: CDN 的十个安全开关：回源鉴权、缓存键、防盗链与日志
description: 边缘 TLS、回源签名、源站网段、缓存键、防盗链、限速、日志——十个开关逐个给出配置项、失效模式与判断依据，附 Nginx、Go、Python 片段与访问日志逐行读。
createdAt: '2026-11-21'
updatedAt: '2026-11-21'
tags: [CDN, 回源鉴权, 缓存投毒, 日志审计]
isPinned: false
growthStage: seedling
---

## 一句话定义

CDN（Content Delivery Network，内容分发网络）把源站的响应缓存到离用户最近的边缘节点（edge）。它的安全价值不在"扛住了多少流量"，而在"它替源站做了哪些判断，以及这些判断能不能被绕过"。边缘终止 TLS（Transport Layer Security，传输层安全协议）、解析 Host、算缓存键、决定是否回源——每一步都有一个默认值，而默认值是给兼容性留的，不是给安全留的。十个开关，就是把这十个默认值逐个改成显式、可解释、可验证的配置。

## 组成与角色

| 环节 | 承载物 | 判断内容 | 默认值的问题 |
|---|---|---|---|
| 边缘 TLS | 证书、协议版本、套件 | 这段连接加密到哪一档 | 为兼容老客户端保留 TLS 1.0/1.1 |
| 缓存键 | scheme + host + path + 白名单 query/header | 哪些请求算"同一个资源" | 忽略全部 query，容易被投毒 |
| 回源链路 | 回源 HOST、端口、协议、源站证书 | 边缘用什么身份访问源站 | 回源走明文 HTTP、跳过证书校验 |
| 源站 | 监听端口、ACL（Access Control List，访问控制列表） | 谁可以直接连进来 | 对全网开放，CDN 形同虚设 |
| 边缘策略 | 方法白名单、限速规则、响应头改写 | 请求配不配被处理 | 放行全部方法、无速率上限 |
| 日志面 | access log、request_id、cache_status | 事后能不能复原一次请求 | 只记状态码，不记命中与回源 |

表里最容易被忽略的是源站那一行。边缘做得再好，只要源站端口对全网开放，攻击者查一次历史 DNS 记录就能绕开全部边缘策略。

## 请求穿过边缘的时序

```
client → edge
  ①  TLS 握手：只接受 ≥ TLS 1.2，SNI（Server Name Indication，服务器名称指示）决定用哪张证书，OCSP（Online Certificate Status Protocol，在线证书状态协议）装订带上吊销状态
  ②  Host 校验：Host 必须属于已配置域名，否则 421 Misdirected Request
  ③  路径归一化：解码 %2e%2e、折叠 //、去掉尾部点，归一化"前后各查一次"
  ④  方法白名单：GET/HEAD/OPTIONS 放行，其余 405 在边缘终止，不回源
  ⑤  限速：按 (client_ip, uri_prefix) 计数，超阈值 429 + Retry-After
  ⑥  缓存键：scheme + host + path + 白名单参数 → 查缓存，HIT 直接返回
  ⑦  回源：加签名头（ts、nonce、sig）、固定回源 HOST、校验源站证书
  ⑧  响应：剥离 Server/X-Powered-By，注入安全响应头，写一条访问日志
```

③ 和 ⑥ 是最常出问题的两个位置：归一化只做一次，等于给 `%2e%2e%2f` 留了绕过；归一化的结果不参与缓存键，等于同一份内容有两个键，缓存和鉴权各算各的。

## 十个开关，逐条讲为什么

**1. 边缘 TLS 的下界与套件。** 配置项是两个值：`min_version=TLS1.2` 和一份套件清单，禁用 RC4、3DES 与 CBC 模式。HSTS（HTTP Strict Transport Security，HTTP 严格传输安全）用 `max-age` 告诉浏览器以后只走 HTTPS，调试期给 `300`，稳定后给 `31536000`（一年）；加 `includeSubDomains` 之前先确认所有子域都有证书，否则一个没证书的子域会把整站访问打断。

**2. 回源 TLS 必须校验证书。** 常见配置是 `origin_tls=on` 配 `origin_verify=off`，理由是"源站用自签证书"。这等于把回源链路降级成"只有攻击者需要伪造证书"的模式：中间人什么都不用做。正确做法是把内部 CA（Certificate Authority，证书颁发机构）的公钥装进边缘信任库，`origin_sni`（SNI，服务器名称指示）写死源站域名，敏感链路再上双向 TLS（mTLS，mutual TLS）加客户端证书。

**3. 源站只放行回源网段。** 入站规则应当是"默认拒绝 + 只允许 CDN 回源段访问 443"，管理端口另开一份更窄的白名单。这一步和"藏源站"是两件事：DNS 历史记录、证书透明日志（CT，Certificate Transparency）、源站自己发出的邮件头、全网扫描都会暴露地址，藏不住，只能让它连不上。

**4. 回源鉴权用时间戳签名，不用固定口令。** 边缘每次回源带 `X-Origin-Auth: ts=<unix>,nonce=<8字节>,sig=<HMAC-SHA256>`，签名覆盖 method + path + ts + nonce。固定 token 泄露一次就永久有效；ts 校验窗口取 ±60 秒容忍时钟漂移，nonce 在窗口内去重（Redis `SETNX` + `TTL=120s`）防重放。HMAC（Hash-based Message Authentication Code，基于哈希的消息认证码）的好处是 secret 不必离开两端。

**5. 防盗链：Referer 只是第一层。** `curl -H 'Referer: https://www.example.com/'` 就能过白名单，它对"浏览器里顺手盗链"有效，对脚本无效。真正拦得住的是签名 URL（`?expires=<unix>&sign=<sig>`，sig 覆盖 path + expires），边缘校验过期时间与签名。顺序很关键：**先校验签名再查缓存**；反过来的话，攻击者用一条合法签名把内容预热进缓存，之后不带签名也能命中。

**6. 缓存键只放白名单参数。** "全部包含"和"全部忽略"都不安全。全部忽略时，攻击者用 `?utm=x` 这类无关参数就能把恶意内容写进正常 URL 的缓存（缓存投毒）；全部包含时，随机参数会把缓存打穿、命中率归零。白名单通常只留 3 到 5 个业务参数，例如 `id`、`page`、`lang`，其余一律丢弃。

**7. Host 与转发头不能进缓存键。** 回源 HOST 固定写死源站域名；`X-Forwarded-Host` 这类客户端可控头既不参与缓存键，也不参与路由。把客户端 Host 带进缓存键的实现，等于每个伪造 Host 都白得一份独立缓存；带进回源 HOST 的实现，等于把边缘变成任意域名都能用的正向代理。

**8. 方法白名单 + 路径归一化。** 静态站只放行 `GET/HEAD/OPTIONS`，其余返回 405，不回源。路径检查必须放在 URL 解码之后：`%2e%2e%2f` 解码后才是 `../`，只查原文等于没查；同时拦 `//`、结尾点、反斜杠，以及超过 4096 字节的超长路径。

**9. 速率限制按维度组合。** 单一 IP 维度会被 NAT（Network Address Translation，网络地址转换）后面的整栋楼误伤，也会被代理池绕过。常见组合：静态资源 `(client_ip, uri_prefix)` 100 r/s、burst 200；登录类接口换成 `(client_ip, account)` 5 r/min。超限返回 429 加 `Retry-After: 1`，不要返回 403——403 会让客户端重试逻辑当成永久失败。

**10. 日志要能复原一次请求。** 最小可用字段集：`time`、`client_ip`、`host`、`method`、`uri`（query 里的 sign/token 脱敏）、`status`、`upstream_status`、`cache_status`（HIT/MISS/PASS/EXPIRED）、`rt`、`bytes`、`request_id`。留存 180 天是审计基线；只记 `status` 的日志在事后追查里几乎没用，因为分不清是源站返回的 5xx 还是边缘自己生成的 5xx。

## 真实配置与日志逐行读

源站侧只做一件事：只接受带合法签名的回源请求。Nginx 用 `auth_request` 把判定委托给一个小服务，回源段之外的连接直接断掉。

```nginx
# 源站入口：默认拒绝 + 回源鉴权
geo $from_cdn { default 0; include /etc/nginx/cdn_ranges.conf; }  # 回源段清单由运维侧生成
server {
    listen 443 ssl;
    server_name origin.example.net;
    if ($from_cdn = 0) { return 444; }        # 非回源段直接断连，连响应都不给
    location = /_cdn_auth {
        internal;
        proxy_pass http://127.0.0.1:8099/verify;   # 校验签名的小服务
        proxy_pass_request_body off;               # 只要头，不要 body
        proxy_set_header X-Origin-Original-URI $request_uri;
    }
    location / {
        auth_request /_cdn_auth;                   # 非 2xx 直接 403，请求不进应用
        proxy_set_header X-Forwarded-For $remote_addr;  # 覆盖而不是追加，防伪造链
        proxy_pass http://app;
    }
}
```

校验服务用 Go 写，三个分支对应三种失效：签名错、时间戳过期、nonce 重放。

```go
// verify.go —— 回源签名校验：常量时间比较 + 时钟窗口 + nonce 去重
func Verify(r *http.Request, secret []byte, seen *redis.Client) error {
	ts := r.Header.Get("X-Origin-Auth-Ts")     // unix 秒
	nonce := r.Header.Get("X-Origin-Auth-Nonce")
	sig := r.Header.Get("X-Origin-Auth-Sig")
	if ts == "" || nonce == "" || sig == "" {
		return errMissing                       // 缺参数即拒绝，不做 fail-open
	}
	t, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return errBadTs
	}
	if d := time.Since(time.Unix(t, 0)); d > 60*time.Second || d < -60*time.Second {
		return errExpired                       // ±60s 窗口容忍 NTP 漂移
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(r.Method + "\n" + r.URL.Path + "\n" + ts + "\n" + nonce))
	want := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(want), []byte(sig)) {  // 必须常量时间，避免逐字节计时侧信道
		return errBadSig
	}
	ok, err := seen.SetNX(context.Background(), "nonce:"+nonce, 1, 120*time.Second).Result()
	if err != nil || !ok {
		return errReplay                          // 同一 nonce 在窗口内二次出现
	}
	return nil
}
```

边缘生成签名 URL 的一端通常是 Python，参数顺序必须和校验端逐字节一致，多一个空格就验不过：

```python
# sign_url.py —— 生成带过期时间的下载地址
import hashlib, hmac, time
from urllib.parse import urlencode

def sign(path: str, secret: bytes, ttl: int = 600) -> str:
    expires = int(time.time()) + ttl             # 10 分钟，短于常见 CDN 缓存 TTL
    msg = f"{path}\n{expires}".encode()          # 行分隔符固定，不要用逗号
    sig = hmac.new(secret, msg, hashlib.sha256).hexdigest()
    return f"{path}?{urlencode({'expires': expires, 'sign': sig})}"
```

一条访问日志，逐字段读：

```
2026-11-21T14:02:11+08:00 host=www.example.com method=GET  uri="/img/logo.png?v=3&sign=***" status=200 upstream=-     cache=HIT  rt=2     bytes=18432 req=7f3a91c2
2026-11-21T14:02:12+08:00 host=www.example.com method=POST uri="/api/order"                   status=405 upstream=-     cache=-    rt=1     bytes=182   req=0b1d4e77
2026-11-21T14:02:13+08:00 host=www.example.com method=GET  uri="/api/list?page=2"             status=502 upstream=504   cache=MISS rt=30012 bytes=0     req=c4e8a102
```

第一行 `cache=HIT`、`upstream=-`，说明没回源，`rt=2` 毫秒；`sign=***` 是脱敏结果，原始 query 不能落盘。第二行 405 且两个字段都是 `-`，代表边缘自己终止，源站根本不知道有这次请求。第三行是这份日志最值钱的地方：`status=502` 配 `upstream=504`，说明源站超时被边缘翻译成了 502，`rt=30012` 正好撞上 30 秒回源超时——只看 `status` 的人会把锅甩给应用。

## 第二个例子：只查 Referer 的防盗链

反例是一套很常见的配置：`Referer` 白名单等于主站域名，就认为盗链封住了。攻击者一条命令就过：

```bash
curl -e 'https://www.example.com/' -o video.mp4 https://cdn.example.net/video.mp4
```

白名单全过，日志里也看不出异常，因为 Referer 头完全合规。这道开关的失效原因是它检查的是"对方自称是谁"，而不是"对方有没有被授权"。补的方式是加一层签名 URL，把有效期压到 10 分钟，第三层在源站按 `(client_ip, uri)` 限制并发连接数与单 IP 带宽。三层里只有签名是密码学保证，Referer 只是一次礼貌询问。

反方向的坑同样存在。浏览器在 `Referrer-Policy: no-referrer` 下不发 Referer，从 HTTPS 页面跳到 HTTP 资源也会被裁掉，隐私模式常把 Referer 削成仅 origin。白名单如果要求 Referer 必须精确匹配、不允许缺失，正常用户会先被自己人挡在门外——这就是"防盗链误伤"，也是白名单配置里必须显式决定"空值放不放行"的原因。

## 五个技术性误解

1. **"上了 CDN，源站 IP 就藏住了。"** 藏不住：DNS 历史、CT 日志、源站自己发出的邮件头、全网 443 端口扫描都能定位。源站只放行回源网段才是控制手段，"藏"只能算附带收益。
2. **"边缘是 HTTPS，链路就全加密了。"** 边缘到源站可以走明文 HTTP，也可以"开了 TLS 但不校验证书"。判断方法是在源站抓一次回源请求：是明文 HTTP 还是 TLS，`origin_verify` 的实际取值是什么。
3. **"缓存键越简单，命中率越高越好。"** 命中率是手段不是目标。忽略参数换来的高命中率，代价是任意参数都能命中同一份缓存，缓存投毒正是吃这个口子。
4. **"限速阈值定高一点，免得误伤。"** 高到不误伤时通常也拦不住攻击。限速的真实作用是在源站扩容完成前争取时间，它是缓冲，不是防护；判断依据是"超限后源站 QPS（Queries Per Second，每秒请求数）曲线掉不掉"。
5. **"日志里的 client_ip 就是客户端。"** `X-Forwarded-For`（XFF，代理转发来源地址头）是客户端可写的。取值规则是从右往左、跳过已知代理段、取第一个非可信地址；左侧的值只能当线索。

## 边界条件

- **Range 请求**：缓存键要包含 `Range`，否则 206 的部分内容与 200 的完整内容会互相覆盖，回出截断的文件。
- **签名有效期与缓存 TTL**（Time To Live，存活时间）：签名短于 TTL 时，过期的 URL 仍可能命中还没过期的缓存。二选一：把 `expires` 纳入缓存键，或让 TTL 小于签名有效期。
- **时钟**：±60 秒窗口要求两端都跑 NTP（Network Time Protocol，网络时间协议）；漂移超过窗口的表现是"全量 403"，而不是偶发失败。
- **IPv6**：按单个地址限速在 IPv6 下几乎无效，一个 /64 前缀内可以轮换大量地址，需要按前缀聚合计数。
- **日志采样**：采样率低于 100% 时，安全事件的时间线无法复原；审计要求全量，性能问题应该靠异步落盘解决，而不是靠采样。
- **动态接口**：`POST/PUT` 一律不回源缓存，但也不能一并 405；方法白名单要按路径前缀分开配置，否则订单接口会被静态规则打死。

## 小结

十个开关的共同点是把默认值改成显式值，其中三个属于必选：源站只放行回源网段、回源签名带时间戳、缓存键走白名单参数。

其余七个决定的是"出事后能不能查清"。日志字段比拦截规则更难补，因为它要回溯历史。

验证方式只有一个：从源站之外直连源站端口，看它是不是拒绝。
