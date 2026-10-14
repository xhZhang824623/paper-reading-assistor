# 部署上云

这个应用是纯静态文件：没有服务端代码，所有数据（论文记录、笔记、PDF）和 API Key 都保存在**使用者自己的浏览器**里。所以"上云"有三个层次，先想清楚要哪一个。

| 层次 | 你得到什么 | 要做的事 | 适合 |
| --- | --- | --- | --- |
| 0 静态托管 | 任何设备打开一个网址就能用；数据仍按浏览器各自保存；Key 各自填 | 跑 `./build.sh`，把 `dist/` 丢到静态托管 | 自己用，一两台电脑 |
| 1 加数据同步 | 多设备看到同一份论文、笔记和知识 | 接一个 BaaS（推荐 Supabase）：登录 + 数据库 + 文件存储，约几百行前端代码 | 自己用，多设备 |
| 2 完整后端 | 多人账号、Key 放服务端、Notion 自动归档、后台任务 | PRD 阶段 B/C 的服务端网关和数据库 | 给别人用，或要自动化 |

个人版现在只需要层次 0。下面是具体做法。

## 层次 0：静态托管（10 分钟）

```bash
cd paper-reading-v2
./build.sh          # 生成 dist/，约 2 MB
```

把 `dist/` 整个目录上传到任一静态托管即可。几个选择：

- **Cloudflare Pages**（推荐，免费，全球 CDN，可以加访问控制）：Dashboard → Workers & Pages → Create → Upload assets，拖入 `dist/`；或装 `wrangler` 后 `npx wrangler pages deploy dist --project-name paper-reading`。
- **Vercel / Netlify**：同样拖 `dist/` 上传，或连接 Git 仓库并把 Build command 留空、Output directory 填 `dist`。
- **GitHub Pages**：把 `dist/` 的内容推到 `gh-pages` 分支。注意 Pages 的网址是公开的。
- **国内：阿里云 OSS / 腾讯云 COS 静态网站**：开启静态网站托管，上传 `dist/`，绑定自己的域名并开 HTTPS。国内访问 Cloudflare / Vercel / GitHub 不稳定，自己主要在国内用就选这条。
- **原型用过的 chatgpt.site 托管**：把 `dist/` 和原来的 `.openai/hosting.json`（`"static": {"directory": "dist"}`）放在同一个目录，用原来的发布流程提交即可，会替换旧原型。

必须是 **HTTPS**（本地 localhost 除外）：文件去重用的 SHA-256 和 IndexedDB 都要求安全上下文。上面所有平台默认都是 HTTPS。

### 上云前后要注意的

1. **数据不会自动跟过去。** 浏览器存储按域名隔离，localhost 上的记录在新网址上看不到。先在本地「设置 → 导出全部记录（JSON）」，到新网址「从备份恢复」。PDF 文件不在备份里，重新导入同一个文件会按哈希自动关联。
2. **Key 要在每台设备的浏览器里各填一次**，它不会随备份走，也不会上传到任何地方。
3. **网址要不要公开。** 应用本身没有任何秘密，别人打开也只能用自己的 Key、看自己的数据。但如果不想被别人用，Cloudflare Pages 可以套一层 Cloudflare Access（邮箱验证码登录，个人免费）；Vercel / Netlify 的密码保护是付费功能；GitHub Pages 无法限制。
4. **AI 平台的可达性和部署地无关**，是使用者浏览器直连：DeepSeek 国内可直连；Anthropic / OpenAI 在国内需要使用者自己有可用网络。Anthropic SDK 已打包进 `vendor/`，不再依赖 esm.sh。
5. **更新版本**：改完代码重新 `./build.sh` 上传即可。数据在浏览器里，不受影响；数据结构有变化时由应用内的 schema 版本号自动迁移。

## 已部署：TeleAgent 的腾讯云（2026-10-13）

- 正式地址：**https://paper.xianghui.fun:8443/** （需要安全组放行 8443）。备用：https://111.229.198.55/ （证书名不匹配，浏览器会提示一次）。
- **为什么是 8443 而不是 443**：服务器在腾讯云上海机房，境内机房对没有 ICP 备案的域名会拦截 80 和 443 端口（HTTP 被 302 到腾讯"未备案"页，HTTPS 握手被重置），IP 直连和非标准端口不受影响。TeleAgent 用 9020/9443 也是这个原因。要用 443，只能给 xianghui.fun 做 ICP 备案（周期数周），或把站点迁到境外机房。
- 形态：独立的 compose 项目 `/home/ubuntu/paperreading`，一个 `nginx:1.27` 容器（`nginxPaperReading`）发布 80 / 443 / 8443，只发静态文件；与 TeleAgent 的 compose 项目互不影响。
- 证书：Let's Encrypt，当前有效期到 2027-01-11。**续期注意**：certbot 现在用 80 端口 HTTP-01 验证，而 80 端口上的域名请求已被备案拦截，到期前自动续期会失败（TeleAgent 的域名同样）。两条出路：
  1. 改用 DNS-01 验证：在阿里云 RAM 建一个只有云解析权限的 AccessKey，服务器上用 certbot-dns-aliyun（或 acme.sh dns_ali）续期，之后全自动。
  2. 完成 ICP 备案后 80 端口恢复，现有 HTTP-01 自动续期即可工作。
  续期钩子 `/etc/letsencrypt/renewal-hooks/deploy/paperreading.sh` 会把新证书复制给两个 nginx 并重载，DNS-01 接入后不用改。
- 更新应用：本地改完代码执行 `deploy/tencent/deploy.sh`。`apply-nginx.sh` 按证书是否存在选 HTTP 或 HTTPS 配置。
- 排错：`ssh teleagent-deploy`，`cd ~/paperreading`，`sudo docker compose logs --tail 50`，`sudo certbot certificates`。

## 层次 1：多设备同步（下一步再做）

推荐 Supabase（免费额度够个人用）：

- Auth：邮箱魔法链接登录，一个账号就是你自己。
- Postgres：一张 `states` 表存整个 JSON 状态（带 `updated_at` 做冲突检测），或拆成 papers / notes / events 几张表。
- Storage：一个私有 bucket 存 PDF，按论文 id 命名，行级权限只允许本人读写。
- 前端：在 `store.save()` 之后做防抖推送，打开应用时拉取并合并（已有的 `mergeImport` 逻辑可以直接复用）。

这样仍然不需要自己运维服务器，应用照旧是静态托管。AI Key 可以继续留在浏览器，也可以挪到 Supabase Edge Functions 里做成服务端调用（这就是 PRD 里的"模型网关"的最小形态）。

## 层次 2：完整后端

需要多人使用、Key 统一管理、Notion 自动写入或后台全文处理时再做。方案见 PRD 第 8、11 节：服务端模型网关 + 数据库 + 对象存储，部署在一台 VPS（Docker Compose）或 PaaS 上。在那之前，层次 0 加手动备份已经能满足个人精读的全部流程。
