---
title: 堡垒机不是跳板机：PAM 的六个控制点
description: 从账号、授权、审批、会话、审计、回收六个控制点拆解 PAM 与跳板机的差别，逐条给失败案例，并附 nftables、sshd 配置与 asciicast 录像逐行读法。
createdAt: '2026-11-12'
updatedAt: '2026-11-12'
tags: [堡垒机, PAM, 访问控制, 审计]
isPinned: false
growthStage: seedling
---

## 一句话定义

跳板机是一台能被 ssh 上去、再 ssh 到别处的主机；堡垒机是一台**终结协议**的主机。前者转发字节，后者理解字节。

PAM（Privileged Access Management，特权访问管理）指把"谁、用哪个账号、在什么时间窗、对哪台资产、执行了什么"变成可执行策略并可回溯证据的一整套设施，堡垒机是它的执行面。

判断标准只有一条：拔掉这台主机，办公网仍能直连目标的 22 端口，那它只是跳板机——绕过成本为零，审计只是君子协定。

## 六个控制点

| 控制点 | 约束什么 | 落到哪个对象 | 缺失时的症状 |
|---|---|---|---|
| 账号 Account Vaulting | 在目标机上以哪个身份登录 | 特权账号清单 + 凭据库 | 共享口令、无法归因到人 |
| 授权 Authorization | 人 × 资产 × 账号，加时间窗 | 授权表 | 权限只增不减、横向越权 |
| 审批 Approval | 高危动作的二次确认 | 工单 + 有效期 | 审批变橡皮章、自批自过 |
| 会话 Session | 协议级代理与转发 | 会话进程、连接 | 直连绕过、录不到 |
| 审计 Audit | 命令、录像、文件传输 | session_id 索引 | 有录像、无检索 |
| 回收 Revocation | 到期、离职、异常 | 断链 + 口令轮换 | 人走了会话还在跑 |

这六点不是功能清单，是一条链：审计的对象是会话，会话的前提是授权，授权的前提是账号能唯一归因到人。链上任何一环不成立，前面几环的强度都归零。

## 一次 SSH 会话的时序

```
① 用户 ──ssh(自己的密钥 + TOTP)──▶ 堡垒机
② 堡垒机 ──查授权 (user, asset, account, now ∈ [start_at, end_at])──▶ 授权库
③ 高危资产 ──▶ 生成工单，等第二人复核，绑定 session_id
④ 堡垒机 ──vault 取目标账号口令──▶ 目标 sshd
⑤ 堡垒机 ⇄ 目标：双向转发 PTY，边转发边落 asciicast + 命令索引
⑥ 退出 / TTL 到期 / 管理员 kill ──▶ 关连接 + 轮换该账号口令
```

- ① 用户对堡垒机认证时用的是**自己的**身份，这是唯一归因的起点。这一步若是共享账号 `ops`，后面所有审计都失去主体。
- ② 三元组里的 account 是目标机上的账号名，不是堡垒机用户名。同一台机器上 `root` 与 `app` 是两个独立的授权对象，权限差别巨大，不能用"该资产已授权"一句概括。
- ④ vault（凭据库）是关键：用户全程不知道目标口令，他能登上去是因为堡垒机替他登。这一步把"凭据分发"改成"凭据使用"，是 PAM 与跳板机最本质的差别。
- ⑤ 证据落在堡垒机，不在目标机。目标机的 `~/.bash_history` 可被 `history -c`、`unset HISTFILE`、`HISTFILE=/dev/null` 三种方式抹掉；PTY 层的字节流抹不掉，除非他能写堡垒机的磁盘。
- ⑥ 断链与轮换必须由同一事件触发，否则会出现"权限已回收、口令没换"的窗口。
## 逐条失败案例

### 账号：共享 root 与硬编码口令

某批 43 台机器 root 口令相同，明文写在内部 wiki。轮换脚本只更新了 vault 和目标机，漏掉两台机器上的定时任务——它们用 `mysql -uroot -p'...'` 把口令硬编码在 shell 脚本里，轮换后备份任务连续 3 天失败。

账号托管的验收标准不是"口令在库里"，而是**轮换后无人报错**。上线前扫一遍 `grep -rIl "password\|passwd\|-p'" /etc/cron* /etc/systemd/system`，把它们改成调 vault 取短期凭据（token 有效期 1 小时），否则轮换只是把故障推到下一次。

另一类失败是全员用 `root` 登录，事后只能定位到"root 执行了 rm -rf /data"。可归因的最小单位是**人 × 账号**：个人账号登录 + `sudo` 提权（`Defaults log_input, log_output` 落 `/var/log/sudo-io/%{user}`），比共享 root 可查得多。

### 授权：三元组退化成资产组

授权按"资产组"发放，某运维被临时加进"数据库组"排查问题，事后无人移除；半年后他仍在组里，可以登全部 60 台库。

授权表必须有 `expires_at`，默认值不能是"永久"，而是工单结束时间 + 30 分钟。粒度也要注意：按主机名授权会被 DNS 或 `/etc/hosts` 绕过，落库要按资产 ID + IP，而不是显示名。

### 审批：橡皮章与无有效期

审批流配置为"组内任一人通过即可"，而审批人本身就在申请人所在的组，实际等于自批。或者审批单没有有效期，一次通过之后该授权永久存在，等于用一次审批换了一张长期通行证。

四眼原则（four-eyes）要求审批人 ∉ 申请人集合；高危资产要求 2 人；审批结果必须绑定 `session_id`，只对这一次会话有效。审批的产物是"一次的许可"，不是"一个人的属性"。

### 会话：网络没有收敛

堡垒机上线了，但办公网到服务器网段仍然放通 22 端口，"为了方便排查"。三个月后回溯一次误删，发现当天没有任何经过堡垒机的 SSH 记录——操作者直连了。

会话代理的价值 = 覆盖率 × 不可绕过。覆盖率不是 100% 的堡垒机，追责时价值接近零：无法证明"没记录等于没发生"。收敛只能在网络层做。

### 审计：有录像、无索引

每天产生 200 GB 整段录像，要查"谁在 3 月 12 日执行了 drop table"，只能人肉拖进度条。另一种是只存了字符流，没有把字符流切成命令索引，于是 `vi` 里改的配置、`mysql` 里执行的 SQL 都埋在录像深处。

审计要有两层：**字节层**完整、不可抵赖；**语义层**可检索——命令、SQL、文件传输、窗口标题。语义层允许不准，但不能没有。查询入口是 `session_id`，它必须同时出现在录像、命令索引、工单、目标机 syslog 四处，缺一处就串不起来。

### 回收：停账号不等于断会话

员工离职，账号在堡垒机停用，但他上午建立的 RDP 会话仍在跑——代理进程持有的是已经建立的 TCP，账号状态不影响存量连接。要真断，得按 `session_id` 杀会话进程。

回收有三个动作，缺一不可：断开存量会话、撤销授权、轮换该账号口令。轮换还有一个坑：目标机口令策略（`pam_pwquality` 的 `minlen`、`remember`、`minclass`）与 vault 的生成规则不一致时改密会失败，而失败通常只报"认证失败"，很容易被当成网络问题查半天。
## 网络收敛：一段可用的 nftables

会话代理必须有网络层兜底，否则"六点"里第 4 点随时能被绕过。下面这段按 VLAN 接口做分区，不依赖 IP 表维护：

```nft
# /etc/nftables.conf
table inet bastion {
  chain forward {
    type filter hook forward priority filter; policy drop;   # ①
    ct state established,related accept                       # ②
    iifname "vlan-bastion" oifname "vlan-server" tcp dport { 22, 3389 } accept  # ③
    iifname "vlan-office"  oifname "vlan-server" ct state new drop              # ④
  }
}
```

- ① `policy drop` 是默认拒绝。写成 `policy accept` 时，下面每条 accept 都退化成注释，而日志里看不出区别——这是上线评审最容易漏的一行。
- ② `ct state established,related` 放行的是**回包**，不是新连接。缺这一条，连 DNS 响应都进不来，表现为"能连上但立刻卡死"。
- ③ `{ 22, 3389 }` 是匿名集合，dport 属于任一即匹配。`iifname` 比 `iif` 稳：接口重建后索引会变，名字不变。
- ④ 办公网段的新连接显式 drop 并计数，这样 `nft list ruleset` 里能看到被拦的包数，用来证明收敛真的生效，而不是规则写错了方向。

验收方式是抓包而不是看配置：在服务器网段镜像一个口，用办公网地址发起 22 连接，预期 SYN 无响应（drop）而不是 RST（reject）。RST 说明路径是通的，只是被中间防火墙拒绝。

## 目标机侧：sshd 的配合项

```sshconfig
# /etc/ssh/sshd_config.d/10-bastion.conf
PermitRootLogin prohibit-password        # 只允许密钥，不接受口令登录
PasswordAuthentication no
AllowTcpForwarding remote                # 允许反向转发，禁止 -L 打洞
PermitOpen none                          # 转发目标白名单为空
ClientAliveInterval 300                  # 5 分钟无数据发探测
ClientAliveCountMax 2                    # 连续 2 次无响应即断开
MaxSessions 4
LogLevel VERBOSE                         # 记录密钥指纹，可回溯到具体 key
```

- `ClientAliveInterval × ClientAliveCountMax` 才是空闲上限：300 × 2 = 10 分钟。只设 Interval 不设 CountMax，默认值是 3，实际是 15 分钟，和文档以为的 5 分钟差三倍。
- `AllowTcpForwarding` 与 `PermitOpen` 管的是两件事：前者是"允不允许转发"，后者是"允许转发到哪里"。直接关掉前者会连带打断需要端口转发的运维流程，结果是被要求全线放开；正确做法是允许转发、用 `PermitOpen` 收窄目标。
- `LogLevel VERBOSE` 会在 auth 日志里记下登录所用密钥的 SHA256 指纹。当堡垒机上存在多把共享运维密钥时，指纹是唯一能区分"是谁"的线索。

## 逐行读一段会话录像

asciicast v2 是堡垒机录像最常见的落盘格式，纯文本、逐行 JSON：

```json
{"version": 2, "width": 120, "height": 34, "timestamp": 1731500000, "env": {"SHELL": "/bin/bash", "TERM": "xterm-256color"}}
[0.412855, "o", "Last login: Thu Nov 12 09:14:02 2026 from bastion01\r\n"]
[1.903441, "o", "ops@db-07:~$ "]
[2.811930, "i", "mysql -uroot -p\r\n"]
[2.815442, "o", "mysql -uroot -p\r\n"]
[3.402118, "o", "Enter password: "]
[9.881004, "o", "mysql> drop table orders_2025;\r\nQuery OK, 0 rows affected\r\n"]
```

- 第一行是 header，只出现一次。`timestamp` 是 UTC 秒，回放器用它折算本地时间；堡垒机与目标机时区不一致时，录像里的时刻会整体偏 8 小时，这是事后对不上 syslog 最常见的原因。
- 之后每行是 `[相对秒, 事件类型, 数据]`。`"o"` 是服务端→客户端（屏幕上出现的字节），`"i"` 是客户端→服务端（键盘输入）。同一条命令因此出现两次：一次 `"i"`，一次 `"o"` 的回显。只录 `"o"` 时回显仍在，但遇到 `Enter password:` 这类不回显的提示符就彻底丢失——口令进不了录像，是设计使然。
- 逐键回显时 `"o"` 会碎成单字符事件（`"m"`、`"y"`、`"s"`）。做命令索引不能按事件切分，必须按 `\r\n` 拼装后再切，否则一条 `mysql` 会被切成十几个片段。
- 末行把 SQL 文本和服务端返回放在同一条 `"o"` 流里，索引时用提示符 `mysql> ` 做锚点，就能把"执行了什么"和"影响了多少行"配成一对。
## 换一个场景：Windows 域管，再走一遍六点

| 控制点 | SSH 侧 | RDP 侧 |
|---|---|---|
| 账号 | 托管 root、应用账号 | 托管域管与本地管理员；本地管理员口令由 LAPS（Local Administrator Password Solution，本地管理员口令方案）按策略自动轮换，密文存于 AD 的 `msLAPS-Password` 属性，默认 30 天 |
| 授权 | 人 × 资产 × 账号 + 时间窗 | 同上，另加"能否使用剪贴板与磁盘重定向"两个开关 |
| 审批 | 工单 + 有效期 | 同左；`mstsc /admin` 抢控制台会话要单独审批 |
| 会话 | PTY 代理 | RDP 代理终结 TLS 后重绘画面，能录屏，录不到命令语义 |
| 审计 | asciicast + 命令索引 | 帧录像 + 窗口标题 + 文件传输记录；`\\tsclient` 重定向是数据外带高发口 |
| 回收 | 断 SSH + 改口令 | 断 RDP + 强制重置本地管理员口令 + 吊销票据 |

RDP 的审计弱项在语义层：屏幕上只有像素。要知道"他打开了哪个程序"，靠的是进程创建事件（安全日志 4688，需开启"审核进程创建"）与窗口标题，不是靠录像。SSH 反过来弱在 TUI：`vi` 里改了什么，转义序列里读不出来，得用文件完整性监控（`auditd` 的 `-w /etc/ -p wa`）兜底。

## 技术性误解

1. **"PAM 就是 Linux 的 PAM"**。Linux PAM（Pluggable Authentication Modules，可插拔认证模块）是 `sshd` 读 `/etc/pam.d/sshd` 的认证框架；安全语境里的 PAM 是 Privileged Access Management。两者的唯一交点是：口令轮换要满足目标机的 PAM 模块策略，否则改密失败。
2. **"有录像就等于合规"**。合规要的是完整性：不可篡改、可检索、留存达标。一段存在可写磁盘、运维本人有 sudo 的录像，证据力为零。需要追加写（append-only）或 WORM（Write Once Read Many，一次写入多次读取）介质，并把录像哈希与 `session_id` 一起入库。
3. **"开了双因子就安全了"**。MFA（Multi-Factor Authentication，多因子认证）回答的是"登录是不是本人"，不回答登录之后能做什么。用自己账号合法登录的人，照样能删库。
4. **"用 ProxyJump 效果一样"**。`ssh -J bastion target` 里，bastion 只做 TCP 转发，看不到加密后的应用层数据，产不出命令级审计，也拿不到目标口令——用户仍需自己持有目标机凭据。
5. **"日志留在目标机就够了"**。`HISTFILE=/dev/null`、`unset HISTFILE`、`history -c` 三招即可清空；`auditd` 的 execve 规则（`-a always,exit -F arch=b64 -S execve -k exec`）能补一层，但 `python -c '...'` 内部做了什么仍然看不到。证据必须落在被审计者无权写的位置。

## 边界条件

- **协议边界**：SSH、RDP、VNC 是交互流，好代理；纯 API 访问（数据库直连、K8s API、对象存储）没有 PTY，代理只能做协议解析或干脆不支持。这类访问的控制点应落在网络策略与短期凭据上，不要硬塞进堡垒机。
- **并发与 IO**：代理要解密再加密，瓶颈通常在录像写盘。200 并发、每会话 1 MB/s 就是 200 MB/s 持续写，磁盘队列打满时的表现是"堡垒机卡"，不是"磁盘满"。
- **单点与热备**：热备同步的是配置，不是已建立的会话；主节点挂掉，存量会话只能重连，所以要给会话最长时长设上限，让重连窗口可预期。
- **时间同源**：录像、目标机 syslog、工单三者的时间必须来自同一 NTP 源，差 8 小时的对账比没有日志更耗人。

## 小结

堡垒机 = 凭据不落地 + 协议终结 + 证据落在被审计者写不到的地方；跳板机只做到其中的"网络位置"。
六个控制点是一条链，最弱一环决定整体强度，网络没收敛时其余五点同时失效。
验收问三句：能否绕过？录像能否检索？人走了会话断没断？
