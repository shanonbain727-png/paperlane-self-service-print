# 纸间 Paperlane · 自助打印系统

单商家、单设备试点版。包含手机网页顾客端及独立商家后台，源码、订单和文件保存在自己控制的环境中。

**当前模式：测试支付 + 待打印 PDF 输出。不会收真钱，不会向实体打印机发任务。**

## 快速开始

需要 Node.js 24.15 或更新的 24.x 版本，以及 LibreOffice。中文封页使用项目内附带的 OFL 开源字体。

```powershell
npm ci
npm run setup
npm run check
npm run dev
```

- 顾客端：http://localhost:5173/
- 商家后台：http://localhost:5173/merchant
- 后台仅需密码登录。初始化生成的随机密码在 `.env` 的 `ADMIN_PASSWORD`，不要公开该文件。
- 密码在第一次启动时以加盐 scrypt 哈希保存；之后通过后台「基础设置」修改。修改 `.env` 不会覆盖已有密码。

### Word 转换

设置 `.env` 的 `SOFFICE_PATH` 指向 LibreOffice 的 `soffice.com`（Windows）或 `soffice`（Linux）。程序自动识别 Windows 常见安装位置、项目内 `.tools/lo-package/program/soffice.com` 及 Linux 标准路径。

当前开发环境使用从 The Document Foundation 官方下载、验证数字签名后解包的 LibreOffice 26.2.6.3，位于 `.tools/lo-package`。此目录不纳入版本管理；换电脑需自行安装 LibreOffice。缺少转换器时后台会明确提示，Word 文件不能虚报转换成功。

转换依赖操作系统字体。Word 排版受字体和转换引擎影响，不能保证与所有版本的 Microsoft Word 完全一致；顾客必须检查转换后的 PDF 预览。复杂排版建议先自行导出 PDF。源文件宏在独立 LibreOffice 配置中设为最高限制，转换进程设有 120 秒超时。

### 手机扫码测试

停止已运行的开发服务后：

```powershell
npm run build
npm run lan
# 多网卡电脑可明确指定地址：
npm run lan -- 192.168.43.180
```

手机和电脑连接同一局域网。脚本会打印实际访问地址；后台「设备管理」的二维码会使用该地址。若 Windows 弹出防火墙提示，仅允许需要使用的可信私有网络。端口默认为 8787，电脑更换网络后需重启 LAN 脚本并重新下载二维码。

本原型不是已加固的公网服务。不要直接把开发端口暴露到公网。上线前需要 HTTPS、反向代理与上传速率限制、隔离文档转换服务、实际支付与设备联调。

## 功能

### 顾客端

- 支持 PDF、DOC、DOCX、JPG、PNG；每单 10 个文件、单文件 30 MB、整单 100 MB。
- 一次多选多张图片或文档，显示批次上传进度；某个文件上传失败时继续处理其他文件。
- 后台真实转换、识别页数；图片显示私有缩略图。拖动左侧手柄排序（支持鼠标和触屏指针），也可用上下按钮或手柄上的方向键调整。
- 每张图片一页，多图片及文档按照当前排列顺序合并为同一个 PDF；可逐页预览转换后的文件。
- A4、黑白任务设定、单面/双面长边翻转、1—20 份；每单最多 2000 个正文印刷面。
- 以正文印刷面计价，默认单面、双面均为每面 0.20 元；封页与补空白免费。
- 可选封页称呼；不收集手机号，不依赖微信资料授权。
- 检查预览与设置后点击「生成合并 PDF」，服务端自动模拟支付成功，直接生成包含封页的最终 PDF。没有额外的确认订单或付款步骤，不会真实扣款。
- 当前浏览器会话识别订单，不提供跨设备用户登录；清除 Cookie 后需商家协助查询。

### 商家后台

- 经营概览：今日订单、模拟支付金额、待处理与异常订单。
- 订单管理：按取件码/称呼/文件名和状态查询，查看详情、下载、重试失败生成、取消未支付订单。
- 价格设置：单面与双面按面价格，服务端保存报价快照；报价有效 15 分钟。
- 设备管理：名称、暂停接单、入口二维码、Word/字体依赖及转换队列状态。
- 封页设置：店名、提示语、称呼显示开关。
- 基础设置：地址、营业信息、客服电话、1—168 小时文件保留时间、修改密码并使其他商家会话失效。

### 输出规则

每个订单一张封页。多个文件合并为一份资料，按份数顺序展开到 PDF，任务份数固定为 1。双面时封页背面空白、每份从新纸正面开始，奇数正文页尾补空白。例如三页正文、双面两份：封页 2 个 PDF 页面 + 正文及空白 4 × 2，共 10 个 PDF 页面（5 张纸）；计价只算 6 个正文面。

正文预览与输出使用同一份标准化 PDF，保留源颜色。黑白和长边双面是未来实际设备的作业设置，本版本不假装已经验证实体效果。识别二维码内容是订单码，不是匿名下载链接。

## 技术结构与数据

```text
src/                 React 顾客端与商家后台
server/app.ts        HTTP 接口、会话、权限与文件访问
server/domain.ts     打印参数校验和服务端计价
server/db.ts         SQLite 表结构、迁移起点和事务
server/pdf.ts        LibreOffice 转换、A4 标准化及封页/正文输出
server/worker.ts     持久队列、重启恢复、过期清理
server/types.ts      文档、订单与支付/打印适配接口
scripts/             初始化、启动、备份、样例与验证工具
tests/               自动化业务与文件处理测试
examples/            自主生成的测试文件
assets/              中文字体及许可证
data/                运行时数据库与私有文件（不提交）
```

SQLite 表：`sessions`、`settings`、`credentials`、`files`、`quotes`、`orders`、`payments`、`events`。数据库启动自动建表。单进程串行处理转换与 PDF 输出，避免原型引入额外消息队列。

接口前缀 `/api`：文件上传/预览、报价、订单/模拟支付/取消/下载；`/api/admin`：登录会话、概览、订单检索/重试、设置、设备、密码。

新订单在一个事务中完成创建和模拟支付，状态直接进入 `generating → ready/failed`；同一个报价重试创建只返回同一订单和一条支付记录。旧版 `awaiting_payment` 订单保留继续生成及取消入口，另有 `cancelled` 和 `expired`。文件状态：`queued → processing → ready/failed → expired`。`ready` 只代表 PDF 生成，绝不表示纸已打印。

默认 24 小时清理源文件、转换文件和输出文件；订单会延长相关源文件保留至自身到期。正在处理的文件与生成中的订单不会被清理。订单摘要继续保留。设置变化应用于新文件和订单。

支付仅有 `mock` 实现，设置其他 `PAYMENT_MODE` 会拒绝启动。打印有文件输出适配器；未来替换为实际执行端时须区分“已提交系统队列”“已完成出纸”“未知”，未知不能盲目重打。

## 验证

```powershell
npm run fixtures
npm test
npm run build
npm run check
```

集成测试使用独立随机目录 `test-results/api-*`，不会修改 `data/` 内的商家密码、订单或设置。Word 验收需要真实 LibreOffice，不跳过、不伪造转换。样例包含中文表格图片 Word、混合页面方向 PDF、EXIF 旋转照片。

测试输出 `summary.json` 提供待打印 PDF 和 Word 转换文件路径，可用 PDF 阅读器或 Poppler 检查。浏览器验收记录另见 `docs/verification.md`。

## 备份

为获得数据库和文件一致的备份，先在后台暂停接单，等待队列结束，然后停止服务：

```powershell
npm run backup
```

恢复时停服，把指定备份中的 `print.sqlite`、`original`、`converted`、`output` 复制到一个新的空数据目录并将 `DATA_DIR` 指向它，然后启动。不要覆盖正在使用的 SQLite 文件；备份可能含旧会话，恢复后应修改商家密码。`.env` 单独安全保管。

## 后续实机上线

需要确定设备驱动和双面能力，接入真实打印适配器，验证卡纸、缺纸、断网、断电与不明结果的人工处理；再接微信商户支付、验签回调、主动查单、退款与对账。当前不实现真实支付、退款、微信小程序、多商家平台或已验证的硬件控制。

## 开源来源

- PDF 操作：pdf-lib（MIT），字体嵌入：@pdf-lib/fontkit（MIT）。
- Word 转换：LibreOffice（独立程序，遵循其许可证）；下载和许可证详见官方站点 https://www.libreoffice.org/ 。
- 中文封页字体：Google Fonts Noto Sans SC（SIL OFL 1.1），由官方可变字体生成 400 字重静态 TrueType，许可证见 `assets/OFL.txt`。来源 https://github.com/google/fonts/tree/main/ofl/notosanssc 。
- 调研过 cups-web、taro-cloud-print、PrintBridge；本版没有复制这些整套应用代码，复用的是独立文档处理组件。业务与界面源码均在本项目中。

应用业务源码版权归项目所有者；第三方组件保留各自许可证。未替项目所有者擅自选择对外开源许可。
