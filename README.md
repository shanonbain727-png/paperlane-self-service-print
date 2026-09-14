# 部署流程

## 1. 安装环境

- 安装 Git。
- 安装 Node.js 24.x，版本不低于 24.15.0，并确认 `node`、`npm` 可在终端运行。
- 安装 LibreOffice，用于 Word 转 PDF；同时安装文档所需的中文字体。
- Windows 和 Linux 均可运行服务。以下命令在项目根目录执行；Linux 部署尚未完成实机验收。

## 2. 获取源码并初始化

```sh
git clone https://github.com/shanonbain727-png/paperlane-self-service-print.git
cd paperlane-self-service-print
npm ci
npm run setup
```

初始化会创建 `.env` 和数据目录；已有 `.env` 不会被覆盖。`npm ci` 请保留开发依赖，构建和启动需要其中的工具。

## 3. 配置环境变量

编辑 `.env`：

```dotenv
PORT=8787
HOST=127.0.0.1
PUBLIC_BASE_URL=http://localhost:8787
ADMIN_PASSWORD=替换为至少12位的随机密码
DATA_DIR=./data
PAYMENT_MODE=mock
FONT_PATH=./assets/NotoSansSC.ttf
```

`npm run setup` 已生成随机的 `ADMIN_PASSWORD`，可直接保留。不要把上面的示例文字作为实际密码。

按安装位置添加 `SOFFICE_PATH`，二选一：

```dotenv
# Windows
SOFFICE_PATH=C:/Program Files/LibreOffice/program/soffice.com
```

```dotenv
# Linux：以实际安装路径为准
SOFFICE_PATH=/usr/bin/libreoffice
```

- 启动账户需要对 `DATA_DIR` 有读写权限，并能执行 LibreOffice。
- 中文封页字体随仓库提供；LibreOffice 需在每台部署机器上单独安装。
- `PAYMENT_MODE` 保持 `mock`：下单自动模拟支付，只生成 PDF，不扣款、不驱动实体打印机。
- 商家密码在首次启动时写入数据库，之后通过后台修改；修改 `.env` 不会重置已有密码。

## 4. 检查、构建和启动

```sh
npm run check
npm run build
npm start
```

检查输出中的密码、字体和 Word 转换器配置。保持进程运行后访问：

- 顾客端：<http://localhost:8787/>
- 商家后台：<http://localhost:8787/merchant>

后台使用 `.env` 中初始化的 `ADMIN_PASSWORD` 登录。上传样例文件、生成并下载 PDF，确认部署成功。

## 5. 局域网手机访问

先停止已有服务，再运行：

```sh
npm run lan
```

脚本会监听本机网卡并输出局域网访问地址，同时设置后台二维码的地址。手机和电脑连接同一网络，在商家后台「设备管理」下载入口二维码。

多网卡机器可指定本机实际局域网 IP，例如：

```sh
npm run lan -- 192.168.1.100
```

允许可信私有网络访问所配置的服务端口，默认 `8787`。更换网络或 IP 后重启 LAN 服务并更新二维码；营业期间关闭电脑自动休眠。

## 6. 域名访问配置

1. 在服务器重复步骤 1—4，使用固定的数据目录和独立的非管理员运行账户。
2. 将域名解析到服务器，配置 HTTPS 反向代理，将请求转发至 `http://127.0.0.1:8787`。
3. 保持 `HOST=127.0.0.1`，将 `PUBLIC_BASE_URL` 改为实际 HTTPS 域名，例如 `https://print.example.com`，然后重启服务。
4. 反向代理需转发完整的 `/api` 路径、保留 Host、允许文件上传并限制上传速率。单次请求上传一个文件，请求体上限可设为 `32 MB`，为最大 `30 MB` 文件预留表单开销。
5. 使用进程管理器设置开机启动和故障重启，工作目录固定为项目根目录，只运行一个服务实例。当前使用本地 SQLite 和单进程任务队列。
6. 为文档转换配置独立的受限运行环境，再验证 HTTPS 登录、上传、Word 转换、下载及后台二维码地址。

此步骤仅部署当前测试版本；真实收款和实体打印需要另行接入与验收。

## 7. 更新部署

先在后台暂停接单，等待任务结束并停止服务，完成备份后执行：

```sh
git pull --ff-only
npm ci
npm run build
npm start
```

局域网部署最后一步改用 `npm run lan`。使用进程管理器时，通过该管理器重启服务，避免启动重复实例。更新时保留 `.env` 和数据目录。

## 8. 备份与恢复

暂停接单、等待任务结束并停止服务后执行：

```sh
npm run backup
```

备份位于 `backups/`。`.env` 需单独安全备份。

恢复时保持停服，把备份中的 `print.sqlite`、`original/`、`converted/`、`output/` 复制到新的空数据目录，将 `.env` 的 `DATA_DIR` 指向该目录后启动。恢复后修改商家密码，使旧后台会话失效。
